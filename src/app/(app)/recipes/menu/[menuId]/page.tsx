import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// QR entry point: always resolve to the CURRENT recipe version of a menu.
export default async function RecipeByMenuPage({ params }: { params: Promise<{ menuId: string }> }) {
  const { menuId } = await params;
  const recipe = await db.recipe.findFirst({
    where: { menuId, isCurrent: true },
    orderBy: { version: "desc" },
  });
  if (!recipe) notFound();
  redirect(`/recipes/${recipe.id}`);
}
