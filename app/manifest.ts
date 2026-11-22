import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Australian Battles",
    short_name: "Aus Battles",
    description: "Claim Australia, one question at a time.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07161a",
    theme_color: "#07161a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
