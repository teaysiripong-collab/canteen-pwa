/**
 * The paid model enhancement is optional. Without an API key the copilot uses the free,
 * deterministic Thai router in `local-assistant.ts`; both modes share the same read-only,
 * permission-scoped tools.
 */

/** Opus 5 — the model this prompt and tool catalogue were written and tested against. */
export const COPILOT_MODEL = "claude-opus-5";

/**
 * Generous, because on this model `max_tokens` caps thinking *and* the reply together —
 * a tight budget truncates the answer mid-sentence rather than making it shorter.
 */
export const COPILOT_MAX_TOKENS = 16_000;

/**
 * Routing a Thai question to one of seven read-only tools and reading back the numbers is
 * short, scoped work. Medium effort answers it well without spending on deliberation the
 * task does not need; raise it here if answers start missing the point.
 */
export const COPILOT_EFFORT = "medium" as const;

/** Stops a tool loop that fails to converge from running up a bill. */
export const COPILOT_MAX_ITERATIONS = 6;

export function copilotApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? key : null;
}

export function isCopilotConfigured(): boolean {
  return copilotApiKey() !== null;
}

/**
 * The whole prompt. Two rules carry the weight: figures come from tools rather than from
 * the model's own memory, and the assistant cannot act — it can only read and explain.
 */
export const COPILOT_SYSTEM_PROMPT = `คุณคือผู้ช่วยของระบบจัดการโรงอาหาร ตอบเป็นภาษาไทยเสมอ

ตัวเลขทุกตัวที่คุณพูดต้องมาจากผลลัพธ์ของเครื่องมือในบทสนทนานี้เท่านั้น
- ห้ามเดา ห้ามประมาณ ห้ามใช้ความรู้ทั่วไปแทนข้อมูลจริงของโรงอาหารนี้
- ถ้าเครื่องมือไม่คืนข้อมูล ให้บอกตรงๆ ว่ายังไม่มีข้อมูล อย่าแต่งตัวเลขขึ้นมา
- ถ้าคำถามต้องใช้ข้อมูลที่คุณยังไม่ได้เรียกเครื่องมือมาดู ให้เรียกเครื่องมือก่อนตอบ

คุณอ่านข้อมูลได้อย่างเดียว ทำรายการแทนผู้ใช้ไม่ได้
- รับของ เบิกของ โอนของ สั่งซื้อ ต้องให้คนกดเองที่หน้าจอ เพราะระบบต้องบันทึกว่าใครเป็นคนทำ
- ถ้าผู้ใช้ขอให้คุณทำรายการ ให้บอกว่าทำแทนไม่ได้ แล้วบอกว่าต้องไปที่หน้าไหน

ถ้าเครื่องมือตอบว่าไม่มีสิทธิ์ ให้บอกผู้ใช้ว่าข้อมูลส่วนนั้นต้องขอสิทธิ์เพิ่ม อย่าพยายามเลี่ยงไปทางอื่น

ตอบสั้น ตรงคำถาม ใส่ตัวเลขพร้อมหน่วย ถ้าตัวเลขบอกอะไรที่ควรรีบทำก็บอกด้วยหนึ่งประโยค`;
