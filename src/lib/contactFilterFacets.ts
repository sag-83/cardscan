/**
 * Faceted filter counts: each dropdown’s numbers reflect the other active
 * filters (e.g. Area = Long Island → Type “Goods shown” shows LI-only count).
 */

import { phoneKey } from './utils'
import { normalizeStateValue } from './usStates'
import type { Contact } from '../types/contact'

export type ContactFilterDims = {
  stars: number
  state: string
  city: string
  area: string
  type: string
  query: string
}

export type ContactFilterDimKey = keyof ContactFilterDims

const EMPTY: ContactFilterDims = {
  stars: 0,
  state: '',
  city: '',
  area: '',
  type: '',
  query: '',
}

export function contactMatchesFilters(
  c: Contact,
  filters: ContactFilterDims,
  exclude?: ContactFilterDimKey,
): boolean {
  const stars = exclude === 'stars' ? 0 : filters.stars
  const state = exclude === 'state' ? '' : filters.state
  const city = exclude === 'city' ? '' : filters.city
  const area = exclude === 'area' ? '' : filters.area
  const type = exclude === 'type' ? '' : filters.type
  const query = exclude === 'query' ? '' : filters.query

  if (stars > 0 && c.stars !== stars) return false
  if (state && normalizeStateValue(c.state) !== state) return false
  if (city && c.city !== city) return false
  if (area && c.area !== area) return false
  if (type === 'customer' && !c.is_customer) return false
  if (type === 'goods_shown' && !c.visited) return false
  if (type === 'old_customer' && !c.is_old_customer) return false

  if (query) {
    const q = query.toLowerCase()
    const hay = [c.name, c.company, c.email, c.phone_mobile, c.phone_work, c.city].join(' ').toLowerCase()
    const textMatch = hay.includes(q)
    const qDigits = phoneKey(query)
    const phoneMatch = qDigits.length >= 3
      && [c.phone_mobile, c.phone_work, c.phone_fax].some((p) => phoneKey(p).includes(qDigits))
    if (!textMatch && !phoneMatch) return false
  }
  return true
}

export function facetPool(
  contacts: Contact[],
  filters: ContactFilterDims,
  exclude: ContactFilterDimKey,
): Contact[] {
  return contacts.filter((c) => contactMatchesFilters(c, filters, exclude))
}

export function buildContactFilterFacets(
  contacts: Contact[],
  partial: Partial<ContactFilterDims>,
) {
  const filters: ContactFilterDims = { ...EMPTY, ...partial }

  const forStars = facetPool(contacts, filters, 'stars')
  const forState = facetPool(contacts, filters, 'state')
  const forCity = facetPool(contacts, filters, 'city')
  const forArea = facetPool(contacts, filters, 'area')
  const forType = facetPool(contacts, filters, 'type')

  const starCounts = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0]])
  forStars.forEach((c) => {
    if (c.stars >= 1 && c.stars <= 4) {
      starCounts.set(c.stars, (starCounts.get(c.stars) ?? 0) + 1)
    }
  })

  const stateCounts = new Map<string, number>()
  forState.forEach((c) => {
    const state = normalizeStateValue(c.state)
    if (!state) return
    stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1)
  })

  const cityCounts = new Map<string, number>()
  forCity.forEach((c) => {
    if (!c.city) return
    cityCounts.set(c.city, (cityCounts.get(c.city) ?? 0) + 1)
  })

  const areaCounts = new Map<string, number>()
  forArea.forEach((c) => {
    if (!c.area) return
    areaCounts.set(c.area, (areaCounts.get(c.area) ?? 0) + 1)
  })

  return {
    starCounts,
    stateCounts,
    cityCounts,
    areaCounts,
    customerCount: forType.filter((c) => c.is_customer).length,
    goodsShownCount: forType.filter((c) => c.visited).length,
    oldCustomerCount: forType.filter((c) => c.is_old_customer).length,
    states: [...stateCounts.keys()].sort(),
    cities: [...cityCounts.keys()].sort(),
    areas: [...areaCounts.keys()].sort(),
  }
}
