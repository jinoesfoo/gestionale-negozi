#!/usr/bin/env python3
"""Pastes a block of infra/README.md into an interactive bash in a pseudo-terminal (100 rows, 300
columns), the way the user does in a key terminal, and answers its key prompts. Dry runs only
(run.sh), with fake keys.

Usage: pty-paste.py <plan.json> <transcript file> <result file>

Plan (JSON):
  env: {name: value}      the whole environment of bash
  rcfile: path            the startup file of bash, after the system's /etc/bash.bashrc, as in a
                          terminal (run.sh sets PS1, PS0 and PROMPT_COMMAND there)
  lines: [text, ...]      commands typed one at a time at the shell prompt before the paste (the
                          key terminal block of step 4 and the fake client, sourced from files)
  paste: path             the block pasted at the next prompt, between the bracketed paste
                          markers, then Enter, as a terminal does with a multi-line paste
  answers: [text, ...]    what to paste at each key prompt "… (incolla e premi Invio; non
                          compare): ", in order
  after: [text, ...]      commands typed one at a time once the prompt is back after the block
Every line and the paste wait for the shell prompt first; the paste also waits until the shell
has turned bracketed paste on at that prompt, or it stops. Key prompts are looked for only after
the shell has taken the pasted text (bracketed paste off again), never in the echo of the paste.
Before every answer it waits until the terminal's echo is off; if echo stays on it stops and
records where. A key prompt beyond the answers gets an empty line (the prompt asks again), and is
counted. At the end it types "exit 0".
Result (JSON): {"exit", "prompts": [prompt text, ...], "echo_on_at": [...], "bracketed": bool,
                "taken_at": where the output of the block starts in the transcript (after the
                echo of the paste, which readline may redraw, clearing the screen when the
                paste is taller than the terminal),
                "prompt_back": the prompt came back after the block, "ended_early": the shell
                ended before "exit 0", "timeout": the time limit of the plan ran out,
                "not_reaped": the shell had not ended 10 s after its terminal closed,
                "answers_used": n}
"""
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

plan_file, transcript_file, result_file = sys.argv[1:4]
plan = json.load(open(plan_file, encoding="utf-8"))
# The shell prompt is counted by the line that PROMPT_COMMAND prints before it (run.sh sets it):
# bash runs PROMPT_COMMAND only when it is about to read a new line, never between the lines of a
# pasted block, while readline may draw PS1 again during a long paste.
READY = b"<<PRONTO>>"
KEY_PROMPT = re.compile(rb"([^\r\n]*\(incolla e premi Invio; non compare\): )")
BRACKETED_ON = b"\x1b[?2004h"
BRACKETED_OFF = b"\x1b[?2004l"  # readline has taken the line, before any of its commands runs

pid, fd = pty.fork()
if pid == 0:
    # Every signal at its default, as when a terminal starts its shell: Python ignores SIGPIPE and
    # SIGXFSZ, and a run.sh started in the background has SIGINT and SIGQUIT ignored, which bash
    # would keep (a block leaving «trap '' INT» would go unseen).
    for s in (signal.SIGINT, signal.SIGQUIT, signal.SIGPIPE, signal.SIGXFSZ):
        signal.signal(s, signal.SIG_DFL)
    # A size, as a terminal has (100 rows, 300 columns): without one readline takes 80x24, and it
    # redraws a typed line taller than that (the state probe of run.sh) by clearing the screen.
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 100, 300, 0, 0))
    os.chdir(plan["env"]["HOME"])
    os.execve("/bin/bash", ["bash", "--noprofile", "--rcfile", plan["rcfile"], "-i"], plan["env"])

transcript = bytearray()
prompts, echo_on_at = [], []
answers = list(plan.get("answers") or [])
answers_used = 0
handled = 0
timed_out = False
ended_early = False
deadline = time.monotonic() + float(plan.get("timeout", 120))


class Stop(Exception):
    pass


def read_some(wait):
    ready, _, _ = select.select([fd], [], [], wait)
    if not ready:
        return True
    try:
        data = os.read(fd, 65536)
    except OSError:
        data = b""
    if not data:
        return False
    transcript.extend(data)
    return True


def read_or_stop(wait):
    """Reads like read_some; if the terminal has closed, the shell ended early: stops."""
    global ended_early
    if not read_some(wait):
        ended_early = True
        raise Stop()


def check_time():
    global timed_out
    if time.monotonic() > deadline:
        timed_out = True
        raise Stop()


def echo_off(timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if not termios.tcgetattr(fd)[3] & termios.ECHO:
            return True
        time.sleep(0.001)
    return False


def write_all(data):
    """Writes in small pieces and keeps reading, so neither side of the terminal fills up."""
    view = memoryview(data)
    while view:
        check_time()
        n = os.write(fd, view[:256])
        view = view[n:]
        read_some(0.005)


def answer_prompts():
    """Answers the key prompts that have appeared since the last call."""
    global handled, answers_used
    for m in KEY_PROMPT.finditer(bytes(transcript), handled):
        handled = m.end()
        prompts.append(m.group(1).decode("utf-8", "replace"))
        if not echo_off():
            echo_on_at.append(prompts[-1])
            raise Stop()
        if answers:
            write_all(answers.pop(0).encode() + b"\r")
            answers_used += 1
        else:
            write_all(b"\r")


def wait_prompt(count, answering=False):
    """Waits until the shell prompt has appeared count times in all."""
    while transcript.count(READY) < count:
        check_time()
        read_or_stop(0.05)
        if answering:
            answer_prompts()


def wait_for(seq, start):
    """Waits until seq is in the transcript from start on; returns the index just after it."""
    while True:
        i = transcript.find(seq, start)
        if i >= 0:
            return i + len(seq)
        check_time()
        read_or_stop(0.05)


result = {"bracketed": False, "prompt_back": False}
try:
    seen = 1
    wait_prompt(seen)
    for line in plan.get("lines") or []:
        write_all(line.encode() + b"\r")
        seen += 1
        wait_prompt(seen)
    # The paste prompt's own bracketed paste switch, which may come with its prompt line or after it.
    ready_at = transcript.rfind(READY)
    end = time.monotonic() + 5
    while BRACKETED_ON not in transcript[ready_at:] and time.monotonic() < end:
        read_or_stop(0.05)
    result["bracketed"] = BRACKETED_ON in transcript[ready_at:]
    if not result["bracketed"]:
        raise Stop()
    paste_start = len(transcript)
    block = open(plan["paste"], encoding="utf-8").read().rstrip("\n").encode()
    write_all(b"\x1b[200~" + block + b"\x1b[201~")
    write_all(b"\r")
    handled = wait_for(BRACKETED_OFF, paste_start)
    result["taken_at"] = handled
    seen += 1
    wait_prompt(seen, answering=True)
    result["prompt_back"] = True
    for line in plan.get("after") or []:
        write_all(line.encode() + b"\r")
        seen += 1
        wait_prompt(seen)
    write_all(b"exit 0\r")
except Stop:
    os.kill(pid, signal.SIGKILL)

end = time.monotonic() + 10
while time.monotonic() < end:  # what is left of the output, until the terminal closes
    ready, _, _ = select.select([fd], [], [], 0.5)
    if not ready:
        continue
    try:
        data = os.read(fd, 65536)
    except OSError:
        break
    if not data:
        break
    transcript.extend(data)
# The terminal closes a moment before the shell can be reaped (its files are closed first).
reap_end = time.monotonic() + 10
done, status = os.waitpid(pid, os.WNOHANG)
while not done and time.monotonic() < reap_end:
    time.sleep(0.01)
    done, status = os.waitpid(pid, os.WNOHANG)
not_reaped = not done
if not done:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
os.close(fd)
code = os.waitstatus_to_exitcode(status)
open(transcript_file, "wb").write(bytes(transcript))
result.update({"exit": code if code >= 0 else 128 - code, "prompts": prompts, "echo_on_at": echo_on_at,
               "timeout": timed_out, "ended_early": ended_early, "not_reaped": not_reaped,
               "answers_used": answers_used})
json.dump(result, open(result_file, "w", encoding="utf-8"), ensure_ascii=False)
