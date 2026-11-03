"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FaGithub } from "react-icons/fa";
import { MELODISTRO_LOGO } from "./melodistro-asset";
import "./entity-hero.css";

export default function SiteCorner() {
  const pathname = usePathname() || "";
  if (pathname === "/song" || pathname.startsWith("/song/")) {
    return (
      <span className="md-corner" aria-label="Melodistro">
        <img src={MELODISTRO_LOGO} alt="Melodistro Distribution" />
      </span>
    );
  }
  return (
    <Link href="https://github.com/OseMine/linked" aria-label="GitHub repository" className="github-link">
      <FaGithub size={20} />
    </Link>
  );
}
