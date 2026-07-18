import { NotebookSurface } from "@/components/notebook/notebook-surface";
import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { parsePersistedLectureDeck } from "@/lib/persisted-deck";

export const dynamic = "force-dynamic";

export default async function NotebookPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const { id: userId } = await ensureLocalUser();
  const { deck: requestedDeckId } = await searchParams;
  const storedDecks = await prisma.deck.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const decks = storedDecks.map(parsePersistedLectureDeck);
  const initialDeckId = decks.some((deck) => deck.deckId === requestedDeckId)
    ? requestedDeckId
    : decks[0]?.deckId;

  return <NotebookSurface decks={decks} initialDeckId={initialDeckId} />;
}
