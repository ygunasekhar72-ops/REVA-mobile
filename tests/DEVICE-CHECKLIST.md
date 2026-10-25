# REVA terminal — device verification checklist

Automated in-browser tests cover the console backend and the marker-protocol
parser. The items below require a real Android device (not verifiable from a
desktop). Run each in the terminal (Files tab → terminal icon) unless noted.

## Interactive terminal (user session)
- [ ] `echo hi | tr a-z A-Z` → `HI` (pipes)
- [ ] `for i in 1 2 3; do echo n$i; done > t.txt && cat t.txt` (redirects + chaining)
- [ ] `cd /sdcard 2>/dev/null || cd $HOME; pwd` then run `pwd` again — cwd persists
- [ ] Arrow keys recall history; Ctrl+C interrupts a running `sleep 60` and the shell survives
- [ ] `bb top` renders; `bb vi /tmp/t` opens and exits (`:q!`)
- [ ] `pkg list` prints busybox applets

## Agent execution (shell_exec)
Ask the agent in chat, Build mode:
- [ ] "Run `uname -a` on the device and tell me the kernel" → activity shows `❯ uname -a`, reply includes kernel string and `[exit 0]`
- [ ] "Run a failing command like `ls /definitely-not-here` and report the exit code" → agent reports nonzero exit, card marked failed
- [ ] "cd into $HOME, create a file with the shell, then read it back with cat" → cwd persists across two shell_exec calls
- [ ] While it runs a `sleep 240`, send another message → no duplicate session corruption (second exec waits/errors, no interleaved output)

## Linux userspace (opt-in, experimental)
- [ ] `lx` → first run downloads Alpine (~4 MB), enters proot shell
- [ ] inside: `apk add --no-cache nodejs git` then `node -v`, `git --version`
- [ ] `exit` returns to Android shell; `lx` again re-enters without re-downloading

## Lifecycle
- [ ] Close and reopen the terminal → sessions restart cleanly
- [ ] Kill the app mid-command → reopen, terminal works
