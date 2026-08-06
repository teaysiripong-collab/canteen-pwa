"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import type { TaskStatus, TaskPriority, Shift } from "@prisma/client";

export async function createTask(formData: FormData) {
  const s = await requireSession();
  if (!can(s.role, "tasks", "edit")) throw new Error("FORBIDDEN");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("ต้องระบุชื่องาน");
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const dateRaw = String(formData.get("date") ?? "").trim();
  const dueRaw = String(formData.get("dueAt") ?? "").trim();

  const task = await db.task.create({
    data: {
      title,
      description: String(formData.get("description") ?? "") || null,
      date: dateRaw ? new Date(dateRaw + "T00:00:00Z") : null,
      dueAt: dueRaw ? new Date(dueRaw) : null,
      shift: (String(formData.get("shift") ?? "") || null) as Shift | null,
      locationId: String(formData.get("locationId") ?? "") || null,
      assigneeId,
      priority: (String(formData.get("priority") ?? "NORMAL")) as TaskPriority,
      remark: String(formData.get("remark") ?? "") || null,
      createdById: s.userId,
    },
  });
  if (assigneeId && assigneeId !== s.userId) {
    await db.notification.create({
      data: { userId: assigneeId, type: "TASK_NEW", title: "มีงานใหม่ที่ได้รับมอบหมาย", message: title, link: "/tasks" },
    });
  }
  await audit({ userId: s.userId, entity: "Task", entityId: task.id, action: "CREATE", detail: `สร้างงาน: ${title}` });
  revalidatePath("/tasks");
}

export async function setTaskStatus(taskId: string, status: TaskStatus) {
  const s = await requireSession();
  if (!can(s.role, "tasks", "edit")) throw new Error("FORBIDDEN");
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  await db.task.update({
    where: { id: taskId },
    data: { status, completedAt: status === "COMPLETED" ? new Date() : null },
  });
  // แจ้งผู้สั่งงานเมื่องานเสร็จ (ลดปัญหา "สั่งแล้วลืม")
  if (status === "COMPLETED" && task.createdById !== s.userId) {
    await db.notification.create({
      data: { userId: task.createdById, type: "TASK_DONE", title: "งานเสร็จแล้ว", message: `${s.name} ทำ "${task.title}" เสร็จแล้ว`, link: "/tasks" },
    });
  }
  await audit({ userId: s.userId, entity: "Task", entityId: taskId, action: "STATUS", oldValue: task.status, newValue: status, detail: task.title });
  revalidatePath("/tasks");
}

export async function cancelTask(taskId: string) {
  const s = await requireSession();
  if (!can(s.role, "tasks", "edit")) throw new Error("FORBIDDEN");
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  await db.task.update({ where: { id: taskId }, data: { status: "CANCELLED" } });
  if (task.assigneeId && task.assigneeId !== s.userId) {
    await db.notification.create({
      data: { userId: task.assigneeId, type: "TASK_CANCELLED", title: "งานถูกยกเลิก", message: task.title, link: "/tasks" },
    });
  }
  await audit({ userId: s.userId, entity: "Task", entityId: taskId, action: "STATUS", oldValue: task.status, newValue: "CANCELLED", detail: task.title });
  revalidatePath("/tasks");
}
