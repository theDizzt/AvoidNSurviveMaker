import { expect, it } from 'vitest';
import { createTranslator, translate, t } from './i18n';
import { createValidateApi } from './validate';
import { createColorsApi } from './colors';

it('supports independent translators without changing the deterministic core default', () => {
  const english = createTranslator('en'), korean = createTranslator('ko');
  expect(korean('common.width')).not.toBe(english('common.width'));
  expect(t('common.width')).toBe(english('common.width'));
  expect(translate('ko', 'level.label', { n: 2, title: 'Test' })).toContain('Test');
  const enApi = createValidateApi(english), koApi = createValidateApi(korean);
  expect(enApi.createEmptyMap().name).toBe(english('map.new'));
  expect(koApi.createEmptyMap().name).toBe(korean('map.new'));
  expect(enApi.createEmptyMap().name).toBe(english('map.new'));
  expect(createColorsApi(korean).switchColor(0).name).toBe(korean('color.pink'));
  expect(createColorsApi(english).switchColor(0).name).toBe(english('color.pink'));
});
