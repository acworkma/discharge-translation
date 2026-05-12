import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';

export default function Home() {
  if (!isAuthenticated()) redirect('/login');
  redirect('/dashboard');
}
