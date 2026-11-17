import { test, expect } from '@playwright/test'

test('la aplicación carga una pantalla útil y no queda en blanco', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', error => pageErrors.push(error))

  await page.goto('/')
  await expect(page.locator('#root')).toBeVisible()
  await expect(page.getByText('Olive Taskboard', { exact: false }).first()).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('el documento tiene identidad de Olive Taskboard', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Olive Taskboard/i)
})
