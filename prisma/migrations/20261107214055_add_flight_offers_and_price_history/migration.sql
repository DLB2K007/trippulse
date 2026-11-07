-- CreateTable
CREATE TABLE "flight_offers" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "data_classification" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departure_date" TIMESTAMP(3) NOT NULL,
    "arrival_date" TIMESTAMP(3) NOT NULL,
    "airline" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "stops" INTEGER NOT NULL,
    "cabin_class" TEXT NOT NULL,
    "baggage_pieces" INTEGER NOT NULL,
    "refundable" BOOLEAN NOT NULL,
    "external_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "base" DOUBLE PRECISION NOT NULL,
    "taxes" DOUBLE PRECISION NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flight_offers_trip_id_external_key_key" ON "flight_offers"("trip_id", "external_key");

-- CreateIndex
CREATE INDEX "price_history_offer_id_observed_at_idx" ON "price_history"("offer_id", "observed_at");

-- AddForeignKey
ALTER TABLE "flight_offers" ADD CONSTRAINT "flight_offers_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "flight_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
