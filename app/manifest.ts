import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Turnova",
    short_name: "Turnova",
    description: "Norwegian-method running coach",
    start_url: "/",
    display: "standalone",
    background_color: "#322a33",
    theme_color: "#ece3ca",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
