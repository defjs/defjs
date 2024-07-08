export const dynamic = 'force-dynamic'

export type User = {
  uid: number
  username: string
}

const users: User[] = [
  { uid: 1, username: 'Jack' },
  { uid: 2, username: 'Jill' },
  { uid: 3, username: 'John' },
  { uid: 4, username: 'Jane' },
  { uid: 5, username: 'Jim' },
  { uid: 6, username: 'Jenny' },
  { uid: 7, username: 'Jerry' },
  { uid: 8, username: 'Jasmine' },
  { uid: 9, username: 'Jesse' },
  { uid: 10, username: 'Jocelyn' },
  { uid: 11, username: 'Jody' },
  { uid: 12, username: 'Joel' },
  { uid: 13, username: 'Joey' },
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const uid = url.searchParams.get('uid')
  const user = users.find(user => user.uid === Number(uid)) || null
  return Response.json(user)
}
