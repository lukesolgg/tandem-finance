import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tandem",
    short_name: "Tandem",
    description: "Money, together — on your terms.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#5b5bd6",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Import statement", url: "/import" },
      { name: "Transactions", url: "/transactions" },
    ],
  };
}
