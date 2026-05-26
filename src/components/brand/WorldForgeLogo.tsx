import { cn } from "@/lib/utils";

type WorldForgeLogoProps = {
  className?: string;
};

export function WorldForgeLogo({ className }: WorldForgeLogoProps) {
  return (
    <img
      src="/brand/worldforge-logo-ui.png"
      alt="WorldForge"
      className={cn("object-contain", className)}
      draggable={false}
    />
  );
}
