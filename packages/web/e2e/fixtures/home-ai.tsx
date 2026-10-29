import React from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { HomeAiProvider, HomeAiPanel, HomeSkeleton } from "@/components/workspaces/home/HomeAi"
import { WidgetGrid } from "@/components/workspaces/home/widgets/WidgetGrid"
import { useWorkspaceHome } from "@/lib/query/hooks/useWorkspaceHome"

function Home() {
  const { data } = useWorkspaceHome("fixture")
  return <main className="mx-auto h-screen max-w-[60rem] overflow-y-auto p-5 sm:p-8"><h1 className="font-display text-3xl">Team workspace</h1><HomeAiPanel onOpenChat={() => {}} />
    {data ? <WidgetGrid workspaceId="fixture" widgets={data.widgets} jobs={[]} onOpenChat={() => {}} onOpenFile={() => {}} /> : <HomeSkeleton />}
  </main>
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><HomeAiProvider workspaceId="fixture"><Home /></HomeAiProvider></QueryClientProvider>)
