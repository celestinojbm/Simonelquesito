/**
 * Guardia global de Vitest (setupFile). Se ejecuta ANTES de que cada archivo de
 * test evalúe sus imports —y por tanto ANTES de que se importe `src/db/index.ts`
 * (que crea el pool)—, así ninguna suite puede consultar una base REMOTA por
 * accidente. Carga el entorno con el mismo mecanismo del proyecto (`load-env`)
 * y rechaza cualquier `DATABASE_URL` no loopback. Las pruebas puras sin BD
 * (sin `DATABASE_URL`) se permiten; una URL remota NUNCA se acepta en silencio.
 */
import "../src/db/load-env";
import { assertTestDatabaseIsLocal } from "../src/db/assert-local-db";

assertTestDatabaseIsLocal();
