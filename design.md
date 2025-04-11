### Schema
```typescript
import {
  schema,
  type TypeOf
} from '@defjs/core/schema'

// Basic types
schema.number()
schema.string()
schema.boolean()
schema.null()
schema.nullish()

// Object Type
schema.file()
schema.blob()
schema.arraybuffer()
schema.object()
schema.array()

// Others
schema.enum()
schema.or()
schema.and()

type RequestSchema = {
  params: Schema,
  query: Schema,
  header: Schema,
  body: Schema,
}

// Function type
schema.request(schema.json({
  id: schema.number(),
  name: schema.string(),
}))
schema.request({
  params: schema.object(),
  query: schema.object(),
  header: schema.object(),
  body: schema.object(),
})
schema.json(schema.object({
  id: schema.number(),
  name: schema.string(),
}))
schema.formData({
  id: schema.number(),
  file: schema.file(),
  files: schema.array(
    schema.file()
  )
})
schema.urlFormData({
  id: schema.number(),
  name: schema.string(),
  status: schema.array(
    schema.enum({
      Active: 0,
      Inactive: 1,
    })
  )
})

const getUserSchema = schema.object({
  id: schema.number().optional().alias('userid'),
  name: schema.string(),
  isAdmin: schema.boolean(),
  order: schema.object({
    id: schema.number(),
    name: schema.string(),
  }),
  roles: schema.array(schema.object({
    id: schema.number(),
    name: schema.string()
  })),
  users: schema.array(schema.or(
    schema.object({
      id: schema.number(),
      name: schema.string()
    }),
    schema.object({
      uid: schema.number(),
    })
  )),
  status: schema.enum(['active', 'inactive']),
  vip: schema.enum({
    Active: 0,
    Inactive: 1,
  }),
  data: schema.or(
    schema.object({
      type: schema.number(),
      uid: schema.number(),
    }),
    schema.object({
      id: schema.number(),
    })
  ),
})

type GetUserSchema = TypeOf<typeof getUserSchema>
```
```typescript
import {
  createGlobalClient,
  defineRequest,
  field
} from '@defjs/core'

createGlobalClient({
  reportAbortError: true,
  reportTimeoutError: true,
})

const userSchema = schema.object({
  id: schema.number(),
  name: schema.string(),
})

const useGetUser: UseRequestFn = defineRequest('GET', '/v1/user/:id')
  .withSchema({
    params: schema.object({
      id: schema.number(),
    }),
  })
  
  .toEventStream({
    message: schema.object({
      id: schema.number(),
      name: schema.string()
    }),
    userconnect: schema.object({
      id: schema.number(),
      time: schema.number()
    }),
    default: schema.object({
      id: schema.number(),
      name: schema.string()
    })
  })
  // switch (event) {
  //    case 'message':
  //      console.log(data) // {id: 1, name: 'jack'}
  //      break
  //    case 'userconnect':
  //      console.log(data) // {id: 1, time: 1234567890}
  //      break
  //    default:
  //      console.log(data) // {id: 1, name: 'jack'}
  //      break
  // }
  
  .toArrayBuffer()
  .toBlob()
  .toText()
  .toJson()
  
  // to schema
  .toJson(userSchema)
  
  // zod parse fn
  .toJson(v => {
    return Schema.parse(x);
    return Schema.parseAsync(x);
  })

type UseRequestFn = {
  doRequest: () => void
  cancel: () => void
  onUploadProgress: (fn: HttpProgressFn) => void
  onDownloadProgress: (fn: HttpProgressFn) => void
}

type UseEventStreamRequestFn = {
  on: <Event, Data>(event?: string, data?: Data) => void
  close: () => void
}

type UseStreamRequestFn = UseRequestFn & {
  
} 
```
