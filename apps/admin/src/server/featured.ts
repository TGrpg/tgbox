import { SiteSettings } from "@tgbox/shared";
import { z } from "zod";

export const FeaturedInput = z.object({ featured: SiteSettings.shape.featured });
