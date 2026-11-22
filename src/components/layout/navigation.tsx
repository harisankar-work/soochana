"use client";

import { AudioLines, Compass, LayoutDashboard, MessagesSquare, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const destinations = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/feedback", label: "Feedback Analysis", icon: MessagesSquare },
  { href: "/issues", label: "Issue Explorer", icon: Compass },
  { href: "/prioritization", label: "Prioritization", icon: Target },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark"><AudioLines aria-hidden="true" size={21} /></span>
        VoiceLoop
      </Link>
      <nav aria-label="Main navigation">
        <ul className="nav-list">
          {destinations.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} aria-current={pathname === href ? "page" : undefined} className="nav-link">
                <Icon aria-hidden="true" size={18} />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
