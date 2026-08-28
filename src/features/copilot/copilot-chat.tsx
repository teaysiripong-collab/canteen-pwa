"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CopilotMessage, CopilotSource } from "@/services/copilot-service";
import { askCopilotAction } from "./actions";

type Turn = CopilotMessage & { sources?: CopilotSource[] };

/**
 * The answer and the buttons that produced it stay next to each other: every reply carries
 * the screens its figures came from, so a supervisor can click through and see the same
 * numbers laid out properly rather than taking the sentence on trust.
 */
export function CopilotChat({ suggestions }: { suggestions: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const send = (question: string) => {
    const text = question.trim();
    if (!text || pending) return;

    setError(null);
    setDraft("");
    const history: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(history);

    startTransition(async () => {
      const result = await askCopilotAction(
        history.map((turn) => ({ role: turn.role, content: turn.content })),
      );

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setTurns([
        ...history,
        { role: "assistant", content: result.data.text, sources: result.data.sources },
      ]);
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-ink-muted">
            ถามเป็นภาษาไทยได้เลย ผู้ช่วยจะไปอ่านข้อมูลจริงของโรงอาหารมาตอบ
            และจะบอกด้วยว่าตัวเลขมาจากหน้าไหน
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="rounded-full border border-border-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {turns.map((turn, index) => (
          <li
            key={`${turn.role}-${index}`}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                turn.role === "user"
                  ? "max-w-[85%] rounded-[var(--radius-card)] bg-brand px-4 py-3 text-ink-inverse"
                  : "max-w-[85%] rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3"
              }
            >
              <p className="whitespace-pre-wrap text-[0.95rem]">{turn.content}</p>

              {turn.sources && turn.sources.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                  <span className="text-xs text-ink-subtle">ข้อมูลจาก</span>
                  {turn.sources.map((source) =>
                    source.href ? (
                      <Link key={source.toolName} href={source.href}>
                        <StatusBadge tone="info">{source.label}</StatusBadge>
                      </Link>
                    ) : (
                      <StatusBadge key={source.toolName} tone="muted">
                        {source.label}
                      </StatusBadge>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {pending ? (
        <p className="text-sm text-ink-muted" role="status">
          กำลังค้นข้อมูล...
        </p>
      ) : null}

      {error ? <FormAlert message={error} /> : null}

      <div ref={endRef} />

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
          placeholder="เช่น ไก่บดเหลือเท่าไร"
          aria-label="คำถามถึงผู้ช่วย"
          className="min-h-14"
          disabled={pending}
        />
        <Button type="submit" size="lg" loading={pending} disabled={!draft.trim()}>
          <Send className="h-5 w-5" aria-hidden />
          <span className="sr-only">ส่ง</span>
        </Button>
      </form>
    </div>
  );
}
