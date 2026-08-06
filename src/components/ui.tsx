import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-[#1e3a5f]">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>{children}</div>;
}

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function Stat({ label, value, href, tone = "default", sub }: {
  label: string; value: React.ReactNode; href?: string;
  tone?: "default" | "green" | "amber" | "red" | "blue"; sub?: string;
}) {
  const tones = {
    default: "border-gray-200",
    green: "border-green-300 bg-green-50",
    amber: "border-amber-300 bg-amber-50",
    red: "border-red-300 bg-red-50",
    blue: "border-sky-300 bg-sky-50",
  };
  const body = (
    <div className={`rounded-xl border ${tones[tone]} bg-white p-3 h-full ${href ? "hover:shadow-md transition-shadow cursor-pointer" : ""}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="text-center text-gray-400 text-sm py-8">{text}</div>;
}

export const btnPrimary = "btn inline-flex items-center justify-center rounded-lg bg-[#1e3a5f] text-white px-4 py-2 text-sm font-semibold hover:bg-[#2d5580] transition-colors";
export const btnSecondary = "btn inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors";
export const btnDanger = "btn inline-flex items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors";
