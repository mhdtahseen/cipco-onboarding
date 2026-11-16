-- Accommodation: a room taken mid-month whose landlord agrees to be paid at the END of that month (15 Nov 2026).
--   Most rooms are unchanged: rent is a full month in advance, due on the 1st and late after the 5th.
--   For the exception, the first month is charged by days (an adjustment, as before) and given a due date: due_on = the last day of that month.
--   Next month's rent for that room is then paid on the same day, together with it (e.g. rent 13,000, taken on the 16th:
--   6,500 for the 15 days + 13,000 for next month = 19,500 on the 30th). After that the room is back to rent in advance on the 1st.
--   No change to payments or to the Accommodation expense posting.

alter table public.accommodation_adjustments add column if not exists due_on date;
