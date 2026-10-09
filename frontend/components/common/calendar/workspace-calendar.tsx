'use client';

import type { CalendarEvent, ViewType } from 'calendarkit-pro';
import { Scheduler } from 'calendarkit-pro';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const HOUR_MS = 60 * 60 * 1000;

function storageKey(orgId: string): string {
   return `berry.calendar.${orgId}`;
}

function revive(value: CalendarEvent): CalendarEvent {
   const recurrence = value.recurrence;
   return {
      ...value,
      start: new Date(value.start),
      end: new Date(value.end),
      recurrence: recurrence?.until
         ? { ...recurrence, until: new Date(recurrence.until) }
         : recurrence,
   };
}

function readStored(orgId: string): CalendarEvent[] {
   try {
      const raw = localStorage.getItem(storageKey(orgId));
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => {
         if (!item || typeof item !== 'object') return [];
         const event = item as CalendarEvent;
         if (typeof event.id !== 'string' || typeof event.title !== 'string') return [];
         return [revive(event)];
      });
   } catch {
      return [];
   }
}

function createdEvent(event: Partial<CalendarEvent>, untitled: string): CalendarEvent {
   const start = event.start instanceof Date ? event.start : new Date();
   const end =
      event.end instanceof Date && event.end.getTime() > start.getTime()
         ? event.end
         : new Date(start.getTime() + HOUR_MS);
   const title = event.title?.trim();
   return {
      id: event.id && event.id !== '' ? event.id : crypto.randomUUID(),
      title: title && title !== '' ? title : untitled,
      start,
      end,
      description: event.description,
      color: event.color,
      allDay: event.allDay,
      calendarId: event.calendarId,
      resourceId: event.resourceId,
      type: event.type,
      guests: event.guests,
      recurrence: event.recurrence,
   };
}

/**
 * The workspace calendar.
 *
 * Events stay in this browser. Berry has no calendar store, so a created
 * event is kept for this workspace on the machine that made it.
 */
export function WorkspaceCalendar() {
   const params = useParams<{ orgId: string }>();
   const orgId = params?.orgId ?? '';
   const t = useTranslations('navigation.sidebar');
   const [events, setEvents] = useState<CalendarEvent[]>([]);
   const [view, setView] = useState<ViewType>('week');
   const [date, setDate] = useState(() => new Date());
   const [ready, setReady] = useState(false);

   useEffect(() => {
      if (orgId === '') return;
      setEvents(readStored(orgId));
      setReady(true);
   }, [orgId]);

   useEffect(() => {
      if (!ready || orgId === '') return;
      localStorage.setItem(storageKey(orgId), JSON.stringify(events));
   }, [events, orgId, ready]);

   const move = (event: CalendarEvent, start: Date, end: Date) => {
      setEvents((current) =>
         current.map((item) => (item.id === event.id ? { ...item, start, end } : item))
      );
   };

   return (
      <div className="berry-calendar flex h-full min-h-0 flex-col">
         <h1 className="sr-only">{t('calendar')}</h1>
         <Scheduler
            className="h-full min-h-0"
            events={events}
            view={view}
            onViewChange={setView}
            date={date}
            onDateChange={setDate}
            isDarkMode
            language="en"
            onEventCreate={(event) => {
               const next = createdEvent(event, t('calendarUntitled'));
               setEvents((current) => [...current, next]);
            }}
            onEventUpdate={(event) => {
               setEvents((current) => current.map((item) => (item.id === event.id ? event : item)));
            }}
            onEventDelete={(id) => {
               setEvents((current) => current.filter((item) => item.id !== id));
            }}
            onEventDrop={move}
            onEventResize={move}
         />
      </div>
   );
}
