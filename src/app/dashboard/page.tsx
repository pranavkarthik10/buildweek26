import { prisma } from "@/lib/db";
import { ensureLocalUser } from "@/lib/local-user";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { id: userId } = await ensureLocalUser();

  const decks = await prisma.deck.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      studySessions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });

  return (
    <DashboardClient
      decks={decks.map((d) => ({
        id: d.id,
        title: d.title,
        courseName: d.courseName,
        totalSlides: d.totalSlides,
        createdAt: d.createdAt.toISOString(),
        lastSession: d.studySessions[0]
          ? {
              id: d.studySessions[0].id,
              status: d.studySessions[0].status,
              currentSlide: d.studySessions[0].currentSlide,
              progressPercent: d.studySessions[0].progressPercent,
              updatedAt: d.studySessions[0].updatedAt.toISOString(),
            }
          : null,
      }))}
    />
  );
}
