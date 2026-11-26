import { Transform } from 'class-transformer';

export const NormalizeEmail = (): PropertyDecorator =>
  Transform(
    ({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    { toClassOnly: true },
  );
