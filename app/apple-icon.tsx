import { ImageResponse } from "next/og";
import { turnovaLogoSvg } from "@/lib/logo-svg";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const svg = turnovaLogoSvg(false);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#9fe88d",
        }}
      >
        <img
          alt=""
          src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          width={180}
          height={180}
        />
      </div>
    ),
    size,
  );
}
