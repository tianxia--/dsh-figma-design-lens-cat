#!/usr/bin/env python3
"""Ask a Jev-style decision model a question, from the command line.

Two things this does that a bare curl does not:

  --repeat runs the same question several times, because these models are
  sensitive to wording and a single answer can be the opposite of the next
  one: the same WiFi layer came back "icon 0.719" and "fragment 0.722" from
  two descriptions of the same facts.

  --vary re-asks with the options in a different order, which is the cheapest
  test for whether an answer reflects the input or the option list.
"""
import argparse, json, os, subprocess, sys, time

DEFAULT_URL = "https://api.codiv.ai/v1/systemone"
# From the environment, never the file: a key written here is in the history
# of every clone the moment it is committed.
DEFAULT_KEY = os.environ.get("DLC_DECISION_KEY", "")


def ask(url, key, model, state, question, timeout=60):
    body = json.dumps({"model": model, "state": state, "questions": {"q": question}})
    cmd = ["curl", "-s", "--max-time", str(timeout), url,
           "-H", "Content-Type: application/json", "-d", body]
    if key:
        cmd[4:4] = ["-H", "Authorization: Bearer " + key]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if not out.stdout.strip():
        raise RuntimeError("no response (" + (out.stderr or "").strip()[:120] + ")")
    data = json.loads(out.stdout)
    if "answers" not in data:
        raise RuntimeError(json.dumps(data)[:200])
    return data["answers"]["q"]


def show(ans):
    kind = ans.get("type")
    if kind == "choice":
        probs = ans.get("probabilities") or {}
        ranked = sorted(probs.items(), key=lambda kv: -kv[1])
        detail = "  ".join("%s=%.3f" % (k, v) for k, v in ranked)
        return "%-12s conf=%.3f   %s" % (ans.get("choice"), ans.get("confidence", 0), detail)
    if kind == "noul":
        return "noul=%.3f" % ans.get("noul", 0)
    if kind == "score":
        return "score=%s conf=%.3f" % (ans.get("score"), ans.get("confidence", 0))
    return json.dumps(ans)[:160]


def main():
    p = argparse.ArgumentParser(description="Ask a decision model one question.")
    p.add_argument("state", help="the text to judge")
    p.add_argument("-q", "--question", default="What is this?",
                   help="the instructions for the question")
    p.add_argument("-o", "--option", action="append", default=[],
                   metavar="NAME=DESCRIPTION",
                   help="a choice option; repeat for each. Omit for a yes/no question.")
    p.add_argument("-s", "--scale", action="append", default=[],
                   help="a rating level; repeat in order for a score question")
    p.add_argument("--url", default=DEFAULT_URL, help="endpoint (use http://127.0.0.1:8009/v1/systemone for local)")
    p.add_argument("--key", default=DEFAULT_KEY, help="bearer token; empty for a local server")
    p.add_argument("--model", default="openjev-latest")
    p.add_argument("--repeat", type=int, default=1, help="ask N times and report the spread")
    p.add_argument("--vary", action="store_true", help="also ask with the options reversed")
    args = p.parse_args()

    if args.option:
        criteria = {}
        for o in args.option:
            name, _, desc = o.partition("=")
            criteria[name.strip()] = desc.strip() or None
        question = {"type": "choice", "instructions": args.question, "criteria": criteria}
    elif args.scale:
        question = {"type": "score", "instructions": args.question, "criteria": args.scale}
    else:
        question = {"type": "noul", "instructions": args.question}

    # A local server takes no bearer token and rejects one.
    key = "" if args.url.startswith("http://127.") or args.url.startswith("http://localhost") else args.key

    runs = [("as given", question)]
    if args.vary and question["type"] == "choice":
        reversed_criteria = dict(reversed(list(question["criteria"].items())))
        runs.append(("reversed", {**question, "criteria": reversed_criteria}))

    print("state: " + args.state)
    print("ask:   " + args.question)
    print()
    for label, q in runs:
        answers = []
        t0 = time.time()
        for _ in range(args.repeat):
            try:
                a = ask(args.url, key, args.model, args.state, q)
            except Exception as e:
                print("  %-9s ERROR %s" % (label, e))
                break
            answers.append(a)
            print("  %-9s %s" % (label, show(a)))
        if len(answers) > 1:
            picks = {a.get("choice") or round(a.get("noul", a.get("score", 0)), 2) for a in answers}
            if len(picks) > 1:
                print("  %-9s UNSTABLE across repeats: %s" % ("", sorted(map(str, picks))))
        if answers:
            print("  %-9s %.2fs/call" % ("", (time.time() - t0) / len(answers)))
        print()

    if len(runs) > 1:
        print("If the two blocks disagree, the answer is following the option order,")
        print("not the input.")


if __name__ == "__main__":
    sys.exit(main())
