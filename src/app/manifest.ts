import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Soochana",
    short_name: "Soochana",
    description: "Customer feedback intelligence and product prioritization.",
    start_url: "/",
    display: "standalone",
    icons: [{ src: "/soochana.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
