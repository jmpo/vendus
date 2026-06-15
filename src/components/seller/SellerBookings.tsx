import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EventTypesManager } from '@/components/admin/booking/EventTypesManager';
import { AvailabilityManager } from '@/components/admin/booking/AvailabilityManager';
import { BookingsManager } from '@/components/admin/booking/BookingsManager';
import { BookingLinkShare } from './BookingLinkShare';
import { SellerCalendar } from './SellerCalendar';
import { MobileSellerCalendar } from '@/components/mobile/MobileSellerCalendar';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';

interface SellerBookingsProps {
  userId: string;
  productId: string;
}

export function SellerBookings({ userId, productId }: SellerBookingsProps) {
  const isMobile = useIsMobile();

  return (
    <div className="space-y-6">
      <Tabs defaultValue="agenda" className="w-full">
        {isMobile ? (
          <ScrollArea className="w-full whitespace-nowrap">
            <TabsList className="inline-flex w-auto min-w-full justify-start gap-1 p-1">
              <TabsTrigger value="agenda" className="shrink-0">Agenda</TabsTrigger>
              <TabsTrigger value="bookings" className="shrink-0">Reuniones</TabsTrigger>
              <TabsTrigger value="event-types" className="shrink-0">Tipos de Evento</TabsTrigger>
              <TabsTrigger value="availability" className="shrink-0">Disponibilidad</TabsTrigger>
              <TabsTrigger value="link" className="shrink-0">Mi Enlace</TabsTrigger>
            </TabsList>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        ) : (
          <TabsList className="grid w-full max-w-2xl grid-cols-5">
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
            <TabsTrigger value="bookings">Reuniones</TabsTrigger>
            <TabsTrigger value="event-types">Tipos de Evento</TabsTrigger>
            <TabsTrigger value="availability">Disponibilidad</TabsTrigger>
            <TabsTrigger value="link">Mi Enlace</TabsTrigger>
          </TabsList>
        )}

        <TabsContent value="agenda" className="mt-6">
          {isMobile ? (
            <MobileSellerCalendar userId={userId} productId={productId} />
          ) : (
            <SellerCalendar userId={userId} productId={productId} />
          )}
        </TabsContent>

        <TabsContent value="bookings" className="mt-6">
          <BookingsManager />
        </TabsContent>

        <TabsContent value="event-types" className="mt-6">
          <EventTypesManager />
        </TabsContent>

        <TabsContent value="availability" className="mt-6">
          <AvailabilityManager />
        </TabsContent>

        <TabsContent value="link" className="mt-6">
          <BookingLinkShare userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
