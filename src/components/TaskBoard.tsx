"use client";

import { useState, useTransition } from "react";
import type { TaskStatus } from "@prisma/client";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priorityLabel: string;
  priorityCls: string;
  assigneeName: string;
  dueText: string | null;
  overdue: boolean;
  locationName: string | null;
};

const COLUMNS: { status: TaskStatus; label: string; cls: string }[] = [
  { status: "NOT_STARTED", label: "ต้องทำ", cls: "border-gray-300" },
  { status: "IN_PROGRESS", label: "กำลังทำ", cls: "border-amber-400" },
  { status: "COMPLETED", label: "เสร็จแล้ว", cls: "border-green-400" },
];

export default function TaskBoard({
  tasks,
  canEdit,
  onMove,
}: {
  tasks: BoardTask[];
  canEdit: boolean;
  onMove: (taskId: string, status: TaskStatus) => Promise<void>;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [pending, startTransition] = useTransition();

  const move = (taskId: string, status: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    startTransition(() => void onMove(taskId, status));
  };

  return (
    <div className={`grid gap-3 md:grid-cols-3 ${pending ? "opacity-70" : ""}`}>
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.status);
        return (
          <div
            key={col.status}
            onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOverCol(col.status); } }}
            onDragLeave={() => setOverCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              if (canEdit && dragId) move(dragId, col.status);
              setDragId(null);
            }}
            className={`rounded-xl border-2 border-dashed p-2 min-h-40 transition-colors ${
              overCol === col.status ? "border-sky-500 bg-sky-50" : col.cls + " bg-gray-50/50"
            }`}
          >
            <div className="font-semibold text-sm px-2 py-1.5 flex justify-between">
              <span>{col.label}</span>
              <span className="text-gray-400">{colTasks.length}</span>
            </div>
            <div className="space-y-2">
              {colTasks.map((t) => (
                <div
                  key={t.id}
                  draggable={canEdit}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  className={`bg-white rounded-lg border border-gray-200 p-3 shadow-sm ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${dragId === t.id ? "opacity-40" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm">{t.title}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${t.priorityCls}`}>{t.priorityLabel}</span>
                  </div>
                  {t.description && <p className="text-xs text-gray-500 mt-1">{t.description}</p>}
                  <div className="text-xs text-gray-400 mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <span>👤 {t.assigneeName}</span>
                    {t.locationName && <span>📍 {t.locationName}</span>}
                    {t.dueText && <span className={t.overdue ? "text-red-600 font-semibold" : ""}>⏰ {t.dueText}</span>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 mt-2 md:hidden">
                      {COLUMNS.filter((c) => c.status !== t.status).map((c) => (
                        <button key={c.status} onClick={() => move(t.id, c.status)}
                          className="text-xs rounded-lg border border-gray-300 px-2 py-1 text-gray-600" style={{ minHeight: "auto" }}>
                          → {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {colTasks.length === 0 && <div className="text-center text-gray-300 text-xs py-6">ไม่มีงาน</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
