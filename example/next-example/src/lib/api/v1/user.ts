import { defineRequest } from '@defjs/core'
import { z } from 'zod'

export const userSchema = z.object({
  id: z.number(),
  name: z.string(),
})

export const useGetUser = defineRequest({
  method: 'GET',
  endpoint: '/api/v1/user',
  transformResponse: response => userSchema.parse(response.body),
})
