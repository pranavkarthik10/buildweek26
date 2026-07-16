import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { redirect } from "next/navigation";
import { SessionPlayer } from "@/components/session-player";
import { parsePersistedLectureDeck } from "@/lib/persisted-deck";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: userId } = await ensureLocalUser();

  const { id } = await params;

  const session = await prisma.studySession.findFirst({
    where: { id, userId },
    include: { deck: true },
  });

  if (!session) redirect("/dashboard");

  const lectureDeck = parsePersistedLectureDeck(session.deck);

  return (
    <SessionPlayer
      sessionId={session.id}
      lectureDeck={lectureDeck}
      initialSlideIndex={session.currentSlide}
      initialCueIndex={session.currentCue}
      initialTeachingFormat={session.teachingFormat}
      initialCustomInstructions={session.customInstructions ?? ""}
      initialBoardSnapshot={session.boardSnapshot ?? undefined}
      initialBoardVersion={session.boardVersion}
    />
  );
}
