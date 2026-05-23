import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";

export function App() {
  return (
    <TooltipProvider>
      <AppShell />
    </TooltipProvider>
  );
}
