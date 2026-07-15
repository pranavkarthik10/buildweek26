import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await ensureLocalUser();

  const { id } = await params;
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return new Response("Not found", { status: 404 });

  await prisma.deck.delete({ where: { id } });
  return new Response(null, { status: 204 });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await ensureLocalUser();

  const { id } = await params;
  const deck = await prisma.deck.findFirst({ where: { id, userId } });
  if (!deck) return new Response("Not found", { status: 404 });

  return Response.json(deck);
}
