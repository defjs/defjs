import { defineEventHandler } from 'h3'

export type User = {
  id: number
  name: string
}

export default defineEventHandler(() => {
  return { id: 1, name: 'Jack' } as User
})
