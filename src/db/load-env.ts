// Carga .env.local ANTES de que cualquier módulo cree el pool de conexión.
// (Los imports de ES modules se evalúan en orden: importa este archivo primero.)
import { config } from "dotenv";
config({ path: ".env.local" });
