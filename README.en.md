<p align="center">
  <a href="README.md">🇮🇹 Italiano</a> ·
  <b>🇬🇧 English</b>
</p>

<p align="center">
  <img src="assets/icons/256x256.png" width="128" alt="PizzaManager logo: a pizza with one slice lifted">
</p>

<h1 align="center">PizzaManager</h1>

<p align="center">
  All your Claude Code, Codex, OpenCode and terminal sessions in a single window.<br>
  Every tab is a real terminal. With tmux, sessions survive even when you close the app.
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#it-updates-itself">Updates</a> ·
  <a href="#what-you-need">Requirements</a> ·
  <a href="#when-something-goes-wrong">Troubleshooting</a>
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/ale-cadei/PizzaManager?label=release&color=F04E23" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Linux-black" alt="macOS and Linux">
  <img src="https://img.shields.io/badge/signed%20%26%20notarized-brightgreen" alt="Signed and notarized for macOS">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white" alt="Electron 33">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-proprietary-lightgrey" alt="Proprietary software"></a>
</p>

<p align="center">
  <img src="docs/assets/readme/screenshot.png" width="880" alt="The PizzaManager window: sidebar with sessions grouped by project on the left, a terminal running Claude Code on the right">
</p>

> **Heads up: the app's interface is in Italian.** This page is translated, the
> app is not (yet). If that's a problem for you, say so in an issue — knowing
> somebody wants it is what would make it worth doing.

If you work with several AI agents from the terminal, you end up with ten
windows open, none of them telling you what it's doing, and every so often you
close one halfway through a task. PizzaManager puts them in a single window,
with a sidebar that tells you **which agent, in which project, and whether it
has finished**. No account, no service in between: it runs on your computer and
launches the binaries you already have installed.

> The source code is right here, and you can build it yourself: see
> [Build it yourself](#build-it-yourself).

## Download

| System | File | Then |
|---|---|---|
| **macOS** Apple Silicon (M1–M4) | [**PizzaManager-mac-arm64.dmg**](../../releases/latest/download/PizzaManager-mac-arm64.dmg) | open it and drag the app into *Applications* |
| **macOS** Intel | [**PizzaManager-mac-x64.dmg**](../../releases/latest/download/PizzaManager-mac-x64.dmg) | same |
| **Linux** | [**PizzaManager-linux-x86_64.AppImage**](../../releases/latest/download/PizzaManager-linux-x86_64.AppImage) | `chmod +x` and run it |
| **Linux** (Debian/Ubuntu) | [PizzaManager-linux-amd64.deb](../../releases/latest/download/PizzaManager-linux-amd64.deb) | `sudo dpkg -i` |

Not sure which Mac you have?  → *About This Mac*: if it says "Apple M…" take
**arm64**, if it says "Intel" take **x64**.

On Linux the **AppImage is the recommended choice**: it is the only format that
updates itself (the `.deb` is handled by `apt`).

The [releases](../../releases) page also carries `.zip`, `.blockmap` and
`latest-*.yml` files: those aren't for you, they are what the app uses to
update itself.

### Build it yourself

```sh
git clone https://github.com/ale-cadei/PizzaManager.git
cd PizzaManager
npm install
npm start                  # run it
npm run install:mac        # or install it, with the app closed
```

A build made this way **does not update itself**: that is on purpose, and it is
how the two of us run it. On Windows there is no package, so this is the only
way.

### The first time you open it

- **macOS**: nothing to do. The `.dmg` is signed with a Developer ID and
  notarized by Apple, so it opens like any other downloaded app.
- **Linux**: nothing to do.
- **Windows**: there is no package yet.

## What it does

|  |  |
|---|---|
| 🍕 **One place for everything** | Terminal, [Claude Code](https://github.com/anthropics/claude-code), [Codex](https://github.com/openai/codex), [OpenCode](https://opencode.ai) and [Antigravity](https://antigravity.google) in tabs, each with its own icon |
| 🔥 **Sessions don't die** | With `tmux` every session lives outside the app: close the window, reopen it, it's still there. After a reboot it offers to restore them, and in shells you get the text back too |
| 🗂 **Grouped the way you think** | By agent or by project (the repository root). A project's `+` opens a new session right there |
| 🔔 **You know when it's done** | A background tab blinks when the agent stops writing, and a system notification can follow: your turn |
| ⟲ **Resume** | Pick up a Claude, Codex, OpenCode or Antigravity conversation from its list, with the right title — and search across all your past ones by text |
| 🌿 **Git and worktrees** | A branch map, branch switching, and a session inside an isolated `git worktree`: two agents on the same repo stop stepping on each other's files |
| 👁 **What it changed** | A panel with the `diff` of what the agent touched, updated while it works |
| 👤 **Several Claude accounts** | OAuth login plus extra API keys, or separate profiles via `CLAUDE_CONFIG_DIR`; you pick per session |
| ⚙️ **Your own commands** | For each type you can define several launch commands (`claude --model opus`, environment variables, and so on) |

## It updates itself

From **1.2.0** on you don't need to come back here. The app checks for a new
version on its own, downloads it while you work, and tells you **once it's
done**: the banner at the top says the new version is ready, and *Restart now*
takes two seconds because the package is already on disk. Open sessions come
back where they were.

If it's a bad moment, *Later* dismisses it and you'll find it again next time.

Two exceptions: with the `.deb`, updates stay with `apt` (the banner tells you
and opens this page), and on Windows there is no package yet.

The installed version is shown under **Help → About PizzaManager**.

## What you need

The agent CLIs are installed separately: the app launches whichever it finds on
your `PATH`, and the legend at the bottom left tells you which ones it found.

[`tmux`](https://github.com/tmux/tmux) is **optional but recommended** on macOS
and Linux: it is what makes sessions survive closing the app. Without it,
processes end with the window.

```sh
brew install tmux          # macOS
sudo apt install tmux      # Debian/Ubuntu
```

### Where your data lives

No telemetry and no account. Everything sits in one folder on your computer:

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/AISessionManager` |
| Linux | `~/.config/AISessionManager` |

The app makes one network request of its own — the fonts, and offline it falls
back to the system ones — plus the update check against this page. Everything
else is the CLIs you launch yourself.

## When something goes wrong

**"Binary `claude` not found on PATH".** Apps launched from Finder or from a
desktop menu don't inherit your shell's PATH. PizzaManager asks your login
shell for it and looks in the usual places (nvm, volta, Homebrew,
`~/.local/bin`), but if yours lives elsewhere, write the full path in *File →
Command configuration…*. The tooltip on the bottom-left legend tells you where
it looked.

**The command works in my terminal but not here.** It's probably a shell alias
or function: here commands run without a shell. Write it out in full, including
variables.

**Sessions disappear when I close the app.** `tmux` isn't installed, or isn't
on your `PATH`; the legend at the bottom says so. Install it and restart the
app.

**A tmux session is stuck.** `tmux -L aisession ls` to list them,
`tmux -L aisession kill-session -t <name>` to close one. Never `kill-server`
without `-L aisession`: you'd take down your own personal sessions.

**The update banner never appears.** The first check runs 10 seconds after
startup and then every 4 hours: if you just opened the app, give it a moment.
With the `.deb` it will never appear in automatic form, by design.

## Feedback and requests

Problems and ideas go here: [Issues](../../issues). The most upvoted ones (👍
on the issue) get looked at first, and when something is being worked on it
gets the *In corso* label.

The app carries the same list in the **📣 Segnalazioni** panel, bottom right:
you can see what we're working on and file a report with your version and
system already filled in.

## License

PizzaManager is **proprietary** software: you may install and use it freely, on
any number of computers, free of charge and without registration. You may not
redistribute or modify it. The full text is in [`LICENSE`](LICENSE).

The third-party components the app bundles — all under permissive licenses —
are listed with their respective licenses in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Copyright © 2026 Giacomo Grieco and Alessandro Cadei.
