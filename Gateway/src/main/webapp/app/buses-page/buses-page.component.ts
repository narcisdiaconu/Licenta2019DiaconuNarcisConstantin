import { Component, OnInit, OnDestroy } from '@angular/core';
import { DataService } from 'app/data.service';
import { Router } from '@angular/router';
import { RouteService } from 'app/entities/routes/route';
import { BusService } from 'app/entities/buses/bus';
import { StationService } from 'app/entities/stations/station';
import { IStation } from 'app/shared/model/stations/station.model';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { IRoute } from 'app/shared/model/routes/route.model';
import { IBus } from 'app/shared/model/buses/bus.model';

import * as mapboxgl from 'mapbox-gl';
import { MapService } from 'app/shared';
import { BusModel } from 'app/models/bus';

import { TravelMode } from '../models/travel-mode-enum';
import { BusStopService } from 'app/entities/buses/bus-stop';
import { IBusStop } from 'app/shared/model/buses/bus-stop.model';
import { ICity } from 'app/shared/model/stations/city.model';
import { CityService } from 'app/entities/stations/city';
import { Coordinate, Profiles, GeoJson } from 'app/shared/map/map.geojson';
import { TicketService } from 'app/entities/tickets/ticket';
import { Location } from '@angular/common';

@Component({
    selector: 'jhi-buses-page',
    templateUrl: './buses-page.component.html',
    styleUrls: ['./buses-page.component.css']
})
export class BusesPageComponent implements OnInit {
    data: any;
    routes: IRoute[];
    stations: IStation[];
    cities: ICity[];
    buses: BusModel[];
    map: mapboxgl.Map;
    startLocation: string;
    endLocation: string;
    timeout: any;
    selectedBus: BusModel;
    showBusStops: boolean;
    showMapView: boolean;
    lastBusId: string;
    startMarker: mapboxgl.Marker;
    endMarker: mapboxgl.Marker;
    cannotGoToBooking = false;
    initializing = true;

    constructor(
        private dataService: DataService,
        private router: Router,
        private routeService: RouteService,
        private busService: BusService,
        private stationService: StationService,
        private mapService: MapService,
        private busStopService: BusStopService,
        private cityService: CityService,
        private ticketService: TicketService,
        private location: Location
    ) {}

    ngOnInit() {
        this.map = undefined;
        this.lastBusId = undefined;
        this.showMapView = false;
        this.showBusStops = false;
        this.buses = [];
        this.dataService.getData().subscribe(data => {
            if (data.route === undefined) {
                this.router.navigate(['']);
            }
            this.data = data;
            this.startLocation = this.data.route.from.name;
            this.endLocation = this.data.route.to.name;
            this.loadData();
        });
    }

    private initializeMap() {
        this.map = new mapboxgl.Map({
            container: 'mapbox',
            style: 'mapbox://styles/mapbox/outdoors-v9',
            zoom: 13,
            center: [27.5855732, 47.1678665]
        });

        this.map.on('load', () => {
            this.map.resize();
            this.getDirections(this.selectedBus);
        });
    }

    loadData() {
        this.findStation();
        this.loadCities();
    }

    private findStation() {
        this.stationService.query().subscribe(
            (res: HttpResponse<IStation[]>) => {
                let start, end;
                this.stations = res.body;
                res.body.forEach(station => {
                    if (station.cityId === this.data.route.from.id) {
                        start = station;
                    }
                    if (station.cityId === this.data.route.to.id) {
                        end = station;
                    }
                });

                // Call to get routes on selected station.
                this.getRoutes(start, end);
            },
            (res: HttpErrorResponse) => console.log(res)
        );
    }

    private getRoutes(startStation, endStation) {
        this.routeService.findByStartAndEnd(startStation.id, endStation.id).subscribe((res: HttpResponse<IRoute[]>) => {
            this.routes = res.body;

            // Call to get all buses for selected route.
            this.routes.forEach(route => {
                const data = {
                    startStation,
                    endStation,
                    route
                };
                this.getBuses(data);
            });
        });
    }

    private getBuses(data) {
        this.busService.getByRoute(data.route.id).subscribe((res: HttpResponse<IBus[]>) => {
            const date = new Date(this.data.route.date);
            // const date = new Date(this.data.route.date.year, this.data.route.date.month, this.data.route.date.day);
            let day = date.getDay();
            if (day === 0) {
                day = 7;
            }

            const buses = this.filterByDate(
                res.body.filter(bus => {
                    return bus.departureTime >= this.data.route.hour;
                }),
                day
            );
            buses.forEach(bus => {
                const busModel = new BusModel(bus, data.route, data.startStation, data.endStation, date, TravelMode.Bus, 0);
                this.buses.push(busModel);
                this.buses.sort((bus1, bus2) => {
                    if (bus1.bus.departureTime < bus2.bus.departureTime) {
                        return -1;
                    } else if (bus1.bus.departureTime > bus2.bus.departureTime) {
                        return 1;
                    }
                    return 0;
                });
            });
            if (this.buses.length > 0) {
                this.selectedBus = this.buses[0];
                this.loadIntermediateStops(this.selectedBus);
            }
            this.initializing = false;
        });
    }

    private filterByDate(buses: IBus[], day: number): IBus[] {
        return buses.filter(bus => {
            return bus.days.charAt(day - 1) === '1';
        });
    }

    private loadCities() {
        this.cityService.query().subscribe((res: HttpResponse<ICity[]>) => {
            this.cities = res.body;
        });
    }

    getTotalTime(bus: IBus) {
        const arrival = bus.arrivalTime.split(':');
        const departure = bus.departureTime.split(':');

        let resultHour = parseInt(arrival[0], 10) - parseInt(departure[0], 10);
        let resultMinute = parseInt(arrival[1], 10) - parseInt(departure[1], 10);

        if (resultMinute < 0) {
            resultHour -= 1;
            resultMinute = 60 + resultMinute;
        }
        return resultHour + ':' + resultMinute;
    }

    getStopsForCurrentBus() {
        const result: IBusStop[] = [];
        const stops = this.selectedBus.bus.busStops;
        if (stops === undefined) {
            return undefined;
        }
        for (let index = 0; index < stops.length; index++) {
            if (stops[index].station === this.selectedBus.end.id) {
                break;
            }
            result.push(stops[index]);
        }
        if (result.length === 0) {
            return undefined;
        }
        return result;
    }

    changeSelected(bus: BusModel) {
        const oldElement = document.getElementById(this.selectedBus.bus.id.toString());
        oldElement.removeAttribute('class');
        oldElement.className = 'list-group-item';
        this.lastBusId = this.selectedBus.bus.id.toString();

        this.selectedBus = bus;
        const element = document.getElementById(bus.bus.id.toString());
        element.className = 'list-group-item selected';

        this.loadIntermediateStops(bus);
        this.drawDirectionOnMap(bus);
    }

    private getDirections(bus: BusModel) {
        const coordinates: Coordinate[] = [];
        coordinates.push(new Coordinate(bus.start.latitude, bus.start.longitude));
        if (bus.bus.busStops !== undefined) {
            bus.bus.busStops.forEach(stop => {
                const station = this.getStationById(stop.station);
                coordinates.push(new Coordinate(station.latitude, station.longitude));
            });
        }
        coordinates.push(new Coordinate(bus.end.latitude, bus.end.longitude));

        this.mapService.retrieveDirections(Profiles.Driving, coordinates).subscribe((res: HttpResponse<any>) => {
            bus.directions = res.body;
            this.updateBusInList(bus);
            this.drawDirectionOnMap(bus);
        });
    }

    private updateBusInList(bus: BusModel) {
        const index = this.buses.findIndex((b: BusModel) => {
            if (b.bus.id === bus.bus.id) {
                return true;
            }
            return false;
        });
        if (index === -1) {
            return;
        }
        this.buses[index] = bus;
        if (this.selectedBus.bus.id === bus.bus.id) {
            this.selectedBus = bus;
        }
    }

    private loadIntermediateStops(bus: BusModel): void {
        if (bus.bus.busStops !== undefined) {
            return;
        }

        this.busStopService.getByBus(bus.bus.id).subscribe((res: HttpResponse<IBusStop[]>) => {
            bus.bus.busStops = res.body;
            this.updateBusInList(bus);
            this.getDirections(bus);
            this.loadOcupiedSeats(bus);
        });
    }

    private loadOcupiedSeats(bus: BusModel) {
        this.ticketService.ocupiedSeats(bus).subscribe((res: HttpResponse<number>) => {
            bus.remainingSeats = bus.bus.totalPlaces - res.body;
            console.log(res.body);
            this.updateBusInList(bus);
        });
    }

    getStationById(id: number): IStation {
        return this.stations.find((station: IStation) => {
            if (station.id === id) {
                return true;
            }
            return false;
        });
    }

    getCityByStation(id: number): ICity {
        const cityId = this.getStationById(id).cityId;

        return this.cities.find((city: ICity) => {
            if (city.id === cityId) {
                return true;
            }
            return false;
        });
    }

    enableMap(): void {
        this.showMapView = !this.showMapView;

        if (this.map === undefined) {
            this.initializeMap();
        } else {
            if (this.selectedBus.directions === undefined) {
                this.getDirections(this.selectedBus);
            } else {
                this.drawDirectionOnMap(this.selectedBus);
            }
        }
    }

    private drawDirectionOnMap(bus: BusModel) {
        if (!this.showMapView) {
            return;
        }
        if (this.lastBusId !== undefined) {
            this.map.setLayoutProperty(this.lastBusId, 'visibility', 'none');
        }

        if (bus.directions === undefined) {
            return;
        }
        if (this.map.getLayer(this.selectedBus.bus.id.toString())) {
            this.map.setLayoutProperty(this.selectedBus.bus.id.toString(), 'visibility', 'visible');
            return;
        }
        const geojson = new GeoJson(bus.directions.routes[0].geometry.coordinates, {});

        // Create markers
        // let markerDiv = document.createElement('div');
        // let icon = document.createElement('fa-icon');
        // icon.setAttribute('icon', 'map-marker');
        // icon.className = 'start-marker';
        // markerDiv.appendChild(icon);

        if (this.startMarker !== undefined) {
            this.startMarker.remove();
        }
        this.startMarker = new mapboxgl.Marker().setLngLat(geojson.geometry.coordinates[0]).addTo(this.map);

        // markerDiv = document.createElement('div');
        // icon = document.createElement('fa-icon');
        // icon.setAttribute('icon', 'map-marker');
        // icon.className = 'end-marker';
        // markerDiv.appendChild(icon);

        if (this.endMarker !== undefined) {
            this.endMarker.remove();
        }
        this.endMarker = new mapboxgl.Marker()
            .setLngLat(geojson.geometry.coordinates[geojson.geometry.coordinates.length - 1])
            .addTo(this.map);

        // Display direction on map
        this.map.addLayer({
            id: bus.bus.id.toString(),
            type: 'line',
            source: {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: geojson.geometry.coordinates
                    }
                }
            },
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#8218f4',
                'line-width': 5
            }
        });

        this.map.flyTo({
            center: geojson.geometry.coordinates[0],
            zoom: 10
        });
    }

    toBooking(): void {
        if (!this.checkIfBusIsAvailable(this.selectedBus)) {
            this.cannotGoToBooking = true;
            return;
        }
        this.cannotGoToBooking = false;
        this.selectedBus.directions = undefined;
        this.data.buses = [this.selectedBus];
        this.dataService.updateData(this.data);
        this.router.navigate(['/booking-page']);
    }

    toMain(): void {
        this.location.back();
    }

    private checkIfBusIsAvailable(bus: BusModel): boolean {
        const today = new Date();
        const date = new Date(bus.date);
        date.setHours(parseInt(bus.bus.departureTime.split(':')[0], 10));
        date.setMinutes(parseInt(bus.bus.departureTime.split(':')[1], 10));
        if (today.getTime() < date.getTime()) {
            return true;
        }
        return false;
    }
}
