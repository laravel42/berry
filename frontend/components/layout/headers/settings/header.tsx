import HeaderNav from './header-nav';

export default function Header({ children }: { children?: React.ReactNode }) {
   return (
      <div className="w-full flex flex-col items-center">
         <HeaderNav trailing={children} />
      </div>
   );
}
