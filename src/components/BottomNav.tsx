import { Link } from "@tanstack/react-router";
import { Library, AudioLines, Mic, Guitar, LayoutGrid } from "lucide-react";

const items = [
  { to: "/", label: "Library", Icon: Library },
  { to: "/analyze", label: "Analyze", Icon: AudioLines },
  { to: "/live", label: "Live", Icon: Mic },
  { to: "/chords", label: "Chords", Icon: LayoutGrid },
  { to: "/tuner", label: "Tuner", Icon: Guitar },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/85 backdrop-blur-xl">
      <ul className="mx-auto flex max-w-lg items-stretch justify-between px-1 pb-[env(safe-area-inset-bottom)]">
        {items.map(({ to, label, Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              className="flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium text-muted-foreground transition-colors"
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "text-primary" }}
            >
              <Icon className="size-5" strokeWidth={2} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
