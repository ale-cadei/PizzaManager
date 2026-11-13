# Helper dell'editor su un server SSH (docs/plans/94-editor-remoto.md).
#
# Il main lo legge e lo manda sullo stdin di `ssh host python3 -c <bootstrap>`:
# sul server non si copia niente. Righe JSON: {"id", "op", "args"} ->
# {"id", "ok", ...}. Le operazioni sono un elenco fisso; ogni percorso arriva
# relativo alla radice della scheda e si rifiuta se, risolti i symlink, ne
# esce. Le regole sono quelle di lib/editor-fs.js. Solo ASCII in questo file:
# il bootstrap ne legge la lunghezza in byte. Python 3.6+, libreria standard.
import base64
import json
import os
import shutil
import subprocess
import sys
import time
from urllib.parse import quote

MAX_READ = 5 * 1024 * 1024
MAX_NAME = 255
MAX_REL = 1024
MAX_IGNORE_CHECK = 5000
HIDDEN = {'.git'}
SKIP_DIRS = {'.git', 'node_modules'}
GIT_COMMANDS = {'ls-files', 'status', 'rev-parse', 'check-ignore', 'cat-file', 'blame', 'grep'}
# Opzioni che fanno eseguire o scrivere qualcosa a git: mai, anche se il main
# costruisce gli argomenti da modelli fissi
GIT_FORBIDDEN = ('-O', '--open-files-in-pager', '--output', '--exec-path', '--upload-pack', '-c', '--config-env')
GIT_ENV = {'GIT_TERMINAL_PROMPT': '0', 'GIT_OPTIONAL_LOCKS': '0', 'LC_ALL': 'C'}


class Fail(Exception):
    def __init__(self, code, message=''):
        Exception.__init__(self, message or code)
        self.code = code


def has_control(s):
    return any(ord(c) < 32 or ord(c) == 127 for c in s)


def mtime(st):
    # Lo stesso numero di mtimeMs di Node (msFromTimeSpec: sec * 1e3 + nsec / 1e6):
    # ns / 1e6 arrotonda diverso in un caso su tre circa, e il confronto fra
    # mtime della scheda remota e di quella locale non torna
    sec, nsec = divmod(st.st_mtime_ns, 10 ** 9)
    return sec * 1e3 + nsec / 1e6


def valid_name(name):
    if not isinstance(name, str) or not name or len(name) > MAX_NAME:
        return False
    return name not in ('.', '..') and '/' not in name and '\\' not in name and not has_control(name)


def rel_parts(rel):
    if not isinstance(rel, str) or len(rel) > MAX_REL or has_control(rel) or rel.startswith('/'):
        raise Fail('EOUTSIDE')
    parts = [p for p in rel.split('/') if p and p != '.']
    if '..' in parts:
        raise Fail('EOUTSIDE')
    return parts


def inside(root, p):
    return p == root or p.startswith(root.rstrip('/') + '/')


def real_root(root):
    if not isinstance(root, str) or not root.startswith('/') or has_control(root):
        raise Fail('EINVAL', 'cartella non valida')
    real = os.path.realpath(root)
    if not os.path.isdir(real):
        raise Fail('ENOENT', 'la cartella non esiste: ' + root)
    return real


def checked(root, p):
    if not inside(root, p):
        raise Fail('EOUTSIDE')
    return p


def resolve_inside(root, rel):
    """Assoluto, symlink seguiti (anche per un percorso che non esiste ancora)."""
    return checked(root, os.path.realpath(os.path.join(root, *rel_parts(rel))))


def resolve_entry(root, rel):
    """La voce stessa, non il bersaglio del symlink: padre risolto + nome. Mai la radice."""
    parts = rel_parts(rel)
    if not parts:
        raise Fail('EOUTSIDE')
    parent = resolve_inside(root, '/'.join(parts[:-1]))
    return checked(root, os.path.join(parent, parts[-1]))


def new_entry(root, rel):
    parts = rel_parts(rel)
    if not parts or not valid_name(parts[-1]):
        raise Fail('EINVALNAME')
    return resolve_entry(root, rel)


def git_env():
    env = dict(os.environ)
    env.update(GIT_ENV)
    return env


def ignored_names(dir_path, names):
    if not names or len(names) > MAX_IGNORE_CHECK:
        return set()
    try:
        r = subprocess.run(['git', 'check-ignore', '-z', '--stdin'], cwd=dir_path, env=git_env(),
                           input='\0'.join(names).encode('utf-8', 'surrogateescape'),
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return set()
    return set(n for n in r.stdout.decode('utf-8', 'replace').split('\0') if n)


# ---------- operazioni ----------

def op_root(a):
    d = a.get('dir')
    if not isinstance(d, str) or has_control(d):
        raise Fail('EINVAL', 'cartella non valida')
    if d == '~' or d.startswith('~/'):
        d = os.path.expanduser(d)
    return {'path': real_root(d)}


def op_resolve(a):
    return {'path': resolve_inside(real_root(a.get('root')), a.get('rel', ''))}


def kind_of(entry):
    try:
        return 'dir' if entry.is_dir(follow_symlinks=True) else 'file'
    except OSError:
        return 'file'


def op_list(a):
    d = resolve_inside(real_root(a.get('root')), a.get('rel', ''))
    with os.scandir(d) as it:
        entries = [{'name': e.name, 'kind': kind_of(e)} for e in it if e.name not in HIDDEN]
    ignored = ignored_names(d, [e['name'] for e in entries])
    for e in entries:
        e['ignored'] = e['name'] in ignored
    return {'entries': entries}


def op_read(a):
    p = resolve_inside(real_root(a.get('root')), a.get('rel', ''))
    st = os.stat(p)
    if not os.path.isfile(p):
        return {'ok': False, 'reason': 'not-file'}
    if st.st_size > MAX_READ:
        return {'ok': False, 'reason': 'too-large'}
    with open(p, 'rb') as f:
        data = f.read(MAX_READ + 1)
    return {'data': base64.b64encode(data).decode('ascii'), 'mtime': mtime(st), 'path': p}


def stat_or_none(p):
    try:
        return os.stat(p)
    except (FileNotFoundError, NotADirectoryError):
        return None


def op_write(a):
    p = resolve_inside(real_root(a.get('root')), a.get('rel', ''))
    before = stat_or_none(p)
    if before is not None and not os.path.isfile(p):
        raise Fail('ENOTFILE')
    disk = mtime(before) if before is not None else None
    if disk != a.get('expectedMtime'):
        return {'ok': False, 'conflict': True, 'mtime': disk}
    if before is not None and not os.access(p, os.W_OK):
        raise Fail('EACCES')
    body = base64.b64decode(a.get('data') or '')
    tmp = os.path.join(os.path.dirname(p), '.%s.aisess-%d-%d.tmp' % (os.path.basename(p), os.getpid(), int(time.time() * 1000)))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(body)
        if before is not None:
            os.chmod(tmp, before.st_mode & 0o777)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return {'mtime': mtime(os.stat(p))}


def op_stat(a):
    st = stat_or_none(resolve_inside(real_root(a.get('root')), a.get('rel', '')))
    return {'exists': st is not None, 'mtime': mtime(st) if st is not None else None}


def op_stat_many(a):
    root = real_root(a.get('root'))
    out = {}
    for rel in a.get('rels') or []:
        try:
            st = stat_or_none(resolve_inside(root, rel))
            out[rel] = mtime(st) if st is not None else None
        except (Fail, OSError):
            out[rel] = None
    return {'mtimes': out}


def op_create(a):
    os.close(os.open(new_entry(real_root(a.get('root')), a.get('rel', '')), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666))
    return {}


def op_mkdir(a):
    os.mkdir(new_entry(real_root(a.get('root')), a.get('rel', '')))
    return {}


def op_rename(a):
    name = a.get('name')
    if not valid_name(name):
        raise Fail('EINVALNAME')
    root = real_root(a.get('root'))
    src = resolve_entry(root, a.get('rel', ''))
    dst = os.path.join(os.path.dirname(src), name)
    s = os.lstat(src)
    try:
        d = os.lstat(dst)
    except FileNotFoundError:
        d = None
    # Stesso inode = cambia solo una maiuscola su un disco che non le distingue
    if d is not None and not (d.st_ino == s.st_ino and d.st_dev == s.st_dev):
        raise Fail('EEXIST')
    os.rename(src, dst)
    parent = '/'.join(rel_parts(a.get('rel', ''))[:-1])
    return {'rel': parent + '/' + name if parent else name}


def op_trash(a):
    """Cestino freedesktop dell'utente sul server: mai unlink, un errore si recupera."""
    p = resolve_entry(real_root(a.get('root')), a.get('rel', ''))
    os.lstat(p)
    data_home = os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share')
    files_dir = os.path.join(data_home, 'Trash', 'files')
    info_dir = os.path.join(data_home, 'Trash', 'info')
    os.makedirs(files_dir, mode=0o700, exist_ok=True)
    os.makedirs(info_dir, mode=0o700, exist_ok=True)
    base = os.path.basename(p)
    name, n = base, 1
    while True:
        info = os.path.join(info_dir, name + '.trashinfo')
        if not os.path.lexists(os.path.join(files_dir, name)):
            try:
                fd = os.open(info, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                break
            except FileExistsError:
                pass
        n += 1
        name = '%s.%d' % (base, n)
    with os.fdopen(fd, 'w') as f:
        f.write('[Trash Info]\nPath=%s\nDeletionDate=%s\n' % (quote(p), time.strftime('%Y-%m-%dT%H:%M:%S')))
    try:
        shutil.move(p, os.path.join(files_dir, name))
    except BaseException:
        os.unlink(info)
        raise
    return {}


def op_walk(a):
    """Fuori da git: la cartella in ampiezza, senza seguire i symlink, fino a `max` file."""
    root = real_root(a.get('root'))
    limit = int(a.get('max') or 20000)
    files, queue = [], ['']
    while queue:
        rel = queue.pop(0)
        try:
            entries = list(os.scandir(os.path.join(root, *rel.split('/')) if rel else root))
        except OSError:
            continue
        for e in entries:
            child = rel + '/' + e.name if rel else e.name
            if e.is_dir(follow_symlinks=False):
                if e.name not in SKIP_DIRS:
                    queue.append(child)
                continue
            if len(files) >= limit:
                return {'files': files, 'truncated': True}
            files.append(child)
    return {'files': files, 'truncated': False}


def check_git_args(args):
    if not isinstance(args, list) or not args or not all(isinstance(x, str) for x in args):
        raise Fail('EINVAL', 'argomenti di git non validi')
    if args[0] not in GIT_COMMANDS:
        raise Fail('EINVAL', 'comando git non ammesso: ' + args[0])
    skip = False
    for x in args[1:]:
        if skip:
            skip = False
            continue
        if x == '--':
            return
        if x == '-e':
            skip = True  # il pattern dopo -e non e' un'opzione
            continue
        if any(x == f or x.startswith(f + '=') or (f == '-O' and x.startswith('-O')) for f in GIT_FORBIDDEN):
            raise Fail('EINVAL', 'opzione di git non ammessa: ' + x)


def op_git(a):
    root = real_root(a.get('root'))
    cwd = checked(root, os.path.realpath(a.get('cwd') or root))
    args = a.get('args')
    check_git_args(args)
    text = a.get('input')
    timeout = a.get('timeout') or None
    try:
        r = subprocess.run(['git'] + args, cwd=cwd, env=git_env(),
                           input=text.encode('utf-8') if isinstance(text, str) else None,
                           stdin=None if isinstance(text, str) else subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout / 1000.0 if timeout else None)
    except FileNotFoundError:
        return {'missing': True}
    except subprocess.TimeoutExpired:
        return {'killed': True, 'status': None, 'stdout': '', 'stderr': ''}
    out = base64.b64encode(r.stdout).decode('ascii') if a.get('buffer') else r.stdout.decode('utf-8', 'replace')
    return {'status': r.returncode, 'stdout': out, 'stderr': r.stderr.decode('utf-8', 'replace')}


OPS = {
    'root': op_root, 'resolve': op_resolve, 'list': op_list, 'read': op_read, 'write': op_write,
    'stat': op_stat, 'stat_many': op_stat_many, 'create': op_create, 'mkdir': op_mkdir,
    'rename': op_rename, 'trash': op_trash, 'walk': op_walk, 'git': op_git,
}


def handle(req):
    rid = req.get('id') if isinstance(req, dict) else None
    try:
        if not isinstance(req, dict) or req.get('op') not in OPS:
            raise Fail('EINVAL', 'operazione sconosciuta')
        args = req.get('args') if isinstance(req.get('args'), dict) else {}
        res = OPS[req['op']](args)
        out = {'ok': True}
        out.update(res)
    except Fail as e:
        out = {'ok': False, 'code': e.code, 'error': str(e)}
    except OSError as e:
        import errno
        out = {'ok': False, 'code': errno.errorcode.get(e.errno, 'EIO'), 'error': e.strerror or str(e)}
    except Exception as e:  # un bug dell'helper non deve chiudere il canale
        out = {'ok': False, 'code': 'EHELPER', 'error': '%s: %s' % (type(e).__name__, e)}
    out['id'] = rid
    return out


def main():
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    stdout.write(b'{"ready": true, "version": 1}\n')
    stdout.flush()
    for line in stdin:
        try:
            req = json.loads(line.decode('utf-8'))
        except ValueError:
            req = None
        stdout.write(json.dumps(handle(req), ensure_ascii=True).encode('ascii') + b'\n')
        stdout.flush()


if __name__ == '__main__':
    main()
