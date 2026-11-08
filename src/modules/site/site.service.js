import { httpError } from "../../lib/httpError.js";
import { LIMITS } from "../../shared/catalog.js";
import { DEFAULT_SITE } from "../../shared/defaults.js";

const onlyVisible = (site) => ({ ...site, products: site.products.filter((product) => product.active) });

function findDuplicate(items) {
  const seen = new Set();
  return items.find(({ id }) => (seen.has(id) ? true : (seen.add(id), false)));
}

// Reglas que JSON Schema no puede expresar: unicidad y referencias entre colecciones.
function assertConsistent(site) {
  for (const [label, list] of [
    ["sección", site.layout.sections],
    ["categoría", site.categories],
    ["producto", site.products],
  ]) {
    const duplicate = findDuplicate(list);
    if (duplicate) throw httpError(400, `Hay más de una ${label} con el id "${duplicate.id}"`);
  }

  const categoryIds = new Set(site.categories.map((category) => category.id));
  const orphan = site.products.find((product) => !categoryIds.has(product.categoryId));
  if (orphan) throw httpError(400, `El producto "${orphan.name}" no tiene una categoría válida`);

  // Una opción «Elegir una/varias» sin alternativas dejaría al cliente sin poder pedir.
  for (const product of site.products.filter((item) => item.customizable)) {
    const names = product.options.map((option) => option.name.trim().toLowerCase());
    const repeated = product.options.find((_, index) => names.indexOf(names[index]) !== index);
    if (repeated) throw httpError(400, `«${product.name}» tiene dos opciones llamadas «${repeated.name}»`);
    const empty = product.options.find((option) => option.type !== "text" && !option.choices.length);
    if (empty) throw httpError(400, `La opción «${empty.name}» de «${product.name}» no tiene alternativas`);
  }

  const { deliveryPoints = [], deliveryAreas = [] } = site.business;
  const pointNames = deliveryPoints.map((point) => point.name.trim().toLowerCase());
  const repeatedPoint = deliveryPoints.find((_, index) => pointNames.indexOf(pointNames[index]) !== index);
  if (repeatedPoint) throw httpError(400, `Hay dos lugares de entrega llamados «${repeatedPoint.name}»`);
  const areaKeys = deliveryAreas.map((area) => `${area.city}|${area.state}`.trim().toLowerCase());
  const repeatedArea = deliveryAreas.find((_, index) => areaKeys.indexOf(areaKeys[index]) !== index);
  if (repeatedArea) throw httpError(400, `La zona «${repeatedArea.city}» está repetida`);

  const featuredCount = site.products.filter((product) => product.featured).length;
  if (featuredCount > LIMITS.FEATURED_PRODUCTS) {
    throw httpError(400, `Solo puedes tener ${LIMITS.FEATURED_PRODUCTS} productos en favoritos (tienes ${featuredCount})`);
  }
}

export function createSiteService(repository) {
  return {
    async getPublicSite() {
      return onlyVisible((await repository.find({ includeHidden: false })) ?? DEFAULT_SITE);
    },

    async getAdminSite() {
      return (await repository.find({ includeHidden: true })) ?? DEFAULT_SITE;
    },

    async saveSite(site) {
      assertConsistent(site);
      await repository.replaceAll(site);
      return this.getAdminSite();
    },
  };
}
