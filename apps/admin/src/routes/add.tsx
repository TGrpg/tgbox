import { createFileRoute } from "@tanstack/react-router";
import { AddPage } from "@/features/add/add-page.tsx";

export const Route = createFileRoute("/add")({
  component: AddPage,
});
