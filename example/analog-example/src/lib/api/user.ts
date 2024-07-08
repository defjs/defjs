import { type MapName, deserialize } from '@deepkit/type'
import { defineRequest } from '@defjs/core'

type User = {
  uid: number & MapName<'id'>
  username: string & MapName<'name'>
}

export const useGetUser = defineRequest({
  method: 'GET',
  endpoint: '/api/v1/user',
  transformResponse: response => deserialize<User>(response.body),
})
