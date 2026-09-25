"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPersonRunning } from "@fortawesome/free-solid-svg-icons";

export function RunnerLogo({
  className = "size-10 shrink-0",
}: {
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <FontAwesomeIcon
        icon={faPersonRunning}
        className="h-[85%] w-auto"
        aria-hidden
      />
    </span>
  );
}
