/**
 * Validación del formulario "Registrar fiado" (mostrador). Es la única fuente
 * compartida entre la consola (deshabilitar el botón) y las pruebas.
 *
 * Coherente con el servidor (`enrollInStoreAction`, `z.string().min(7)`): el
 * teléfono se valida por cantidad de DÍGITOS (≥ 7), lo que implica también ≥ 7
 * caracteres. No se imponen reglas telefónicas nuevas ni se restringe a un país
 * aquí: la normalización específica (celular colombiano) sigue ocurriendo en el
 * servidor sin cambios.
 */
export function enrollPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isEnrollPhoneValid(phone: string): boolean {
  return enrollPhoneDigits(phone).length >= 7;
}

/**
 * ¿El formulario habilita el registro? Nombre con ≥ 2 caracteres tras `trim`,
 * teléfono con ≥ 7 dígitos y monto mayor que cero. El estado "operación
 * pendiente" lo gestiona el componente por separado.
 */
export function canSubmitEnroll(input: { fullName: string; phone: string; amountCop: number }): boolean {
  return (
    input.fullName.trim().length >= 2 &&
    isEnrollPhoneValid(input.phone) &&
    input.amountCop > 0
  );
}
