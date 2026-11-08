import { createSiteRepository } from "./site.repository.js";
import { siteBodySchema } from "./site.schemas.js";
import { createSiteService } from "./site.service.js";

const PUBLIC_CACHE_CONTROL = "no-cache";

export default async function siteRoutes(app) {
  const repository = createSiteRepository(app.mongo);
  const service = createSiteService(repository);
  await repository.ensureIndexes();

  app.get("/site", async (_request, reply) => {
    reply.header("Cache-Control", PUBLIC_CACHE_CONTROL);
    return service.getPublicSite();
  });

  app.register(async (admin) => {
    admin.addHook("onRequest", app.authenticate);

    admin.get("/admin/site", async () => service.getAdminSite());
    admin.put("/admin/site", { schema: { body: siteBodySchema } }, async (request) => service.saveSite(request.body));
  });
}
