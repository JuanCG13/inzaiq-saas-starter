export interface TemplateConfig { name:string; description:string; kind:"ecommerce"|"pos"; currency:string; locale:string; modules:{catalog:boolean; inventory:boolean; orders:boolean; mcp:boolean} }
export const templateConfig:TemplateConfig = {
  "name": "NOMA",
  "description": "Objetos cotidianos. Diseño extraordinario.",
  "kind": "ecommerce",
  "currency": "USD",
  "locale": "es-PY",
  "modules": {
    "catalog": true,
    "inventory": true,
    "orders": true,
    "mcp": true
  }
};
