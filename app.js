/* Otrerastone Lead Generator Logic + Map
   Strict Schema: No ratings, no review counts.
*/

// State
let leadsData = [];
let isSearching = false;
let map;       // Google Map instance
let markers = []; // Array to hold map markers

// DOM Elements
const btnSearch = document.getElementById('btnSearch');
const btnExport = document.getElementById('btnExportCSV');
const btnCopy = document.getElementById('btnCopyClipboard');
const statusDiv = document.getElementById('statusIndicator');
const tableBody = document.querySelector('#resultsTable tbody');
const locationRadios = document.getElementsByName('locationType');
const customAddressInput = document.getElementById('customAddress');

// --- Event Listeners ---

// Toggle Address Input
locationRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        customAddressInput.disabled = (e.target.value === 'current');
    });
});

btnSearch.addEventListener('click', startSearch);
btnExport.addEventListener('click', exportToCSV);
btnCopy.addEventListener('click', copyToClipboard);

// --- Core Logic ---

async function startSearch() {
    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
        alert("Please enter a valid Google Maps API Key.");
        return;
    }

    const keywordsRaw = document.getElementById('keywords').value;
    const keywords = keywordsRaw.split(',').map(k => k.trim()).filter(k => k);
    
    if (keywords.length === 0) {
        alert("Please enter at least one keyword.");
        return;
    }

    setLoading(true);
    leadsData = []; // Clear previous results
    renderTable();

    try {
        // 1. Load Google Maps Script if not loaded
        if (!window.google || !window.google.maps) {
            await loadGoogleMapsScript(apiKey);
        }

        // 2. Determine Center Coordinates
        const location = await getSearchLocation(apiKey);
        const radius = document.getElementById('radius').value;

        // 3. Initialize Map at this location
        initMap(location);

        // 4. Iterate Keywords
        for (const keyword of keywords) {
            updateStatus(`Searching for: ${keyword}...`);
            await fetchPlaces(location, radius, keyword);
        }

        updateStatus(`Completed. Found ${leadsData.length} leads.`);
    } catch (error) {
        console.error(error);
        updateStatus(`Error: ${error.message}`);
        alert(`Search failed: ${error.message}`);
    } finally {
        setLoading(false);
    }
}

function loadGoogleMapsScript(apiKey) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Google Maps Script"));
        document.head.appendChild(script);
    });
}

async function getSearchLocation(apiKey) {
    const type = document.querySelector('input[name="locationType"]:checked').value;

    if (type === 'current') {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) reject(new Error("Geolocation not supported"));
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => reject(new Error("Permission denied or location unavailable."))
            );
        });
    } else {
        const address = customAddressInput.value.trim();
        if (!address) throw new Error("Please enter an address.");
        
        // Geocoding API call
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "OK") throw new Error(`Geocoding failed: ${data.status}`);
        return data.results[0].geometry.location;
    }
}

// --- Map Functions ---

function initMap(centerLocation) {
    const center = new google.maps.LatLng(centerLocation.lat, centerLocation.lng);
    
    if (!map) {
        map = new google.maps.Map(document.getElementById('map'), {
            center: center,
            zoom: 13,
            mapTypeControl: false,     // Clean look
            streetViewControl: false   // Clean look
        });
    } else {
        map.setCenter(center);
        map.setZoom(13);
    }

    // Clear old markers
    markers.forEach(m => m.setMap(null));
    markers = [];
}

function createMarker(place) {
    if (!place.geometry || !place.geometry.location) return;

    const marker = new google.maps.Marker({
        map: map,
        position: place.geometry.location,
        title: place.name,
        animation: google.maps.Animation.DROP // The "Pin Drop" effect
    });

    // Info Window on click
    const infoWindow = new google.maps.InfoWindow({
        content: `<div style="padding:5px; color:#000;">
                    <strong>${place.name}</strong><br>
                    <span style="font-size:0.85em">${place.formatted_address || ''}</span>
                  </div>`
    });

    marker.addListener("click", () => {
        infoWindow.open(map, marker);
    });

    markers.push(marker);
}

// --- Places Search ---

function fetchPlaces(location, radius, keyword) {
    return new Promise((resolve, reject) => {
        const center = new google.maps.LatLng(location.lat, location.lng);
        // Bind PlacesService to the Map instance for better context
        const service = new google.maps.places.PlacesService(map); 

        const request = {
            location: center,
            radius: parseInt(radius),
            keyword: keyword
        };

        service.nearbySearch(request, (results, status, pagination) => {
            if (status === google.maps.places.PlacesServiceStatus.OK) {
                
                results.forEach(place => {
                    // Stagger requests to avoid "OVER_QUERY_LIMIT"
                    setTimeout(() => {
                        service.getDetails({
                            placeId: place.place_id,
                            fields: ['name', 'formatted_phone_number', 'website', 'formatted_address', 'url', 'geometry'] 
                        }, (placeDetails, detailStatus) => {
                            if (detailStatus === google.maps.places.PlacesServiceStatus.OK) {
                                addLeadToTable(placeDetails, keyword);
                            }
                        });
                    }, 300); // 300ms delay per item
                });

                // Handle Pagination
                if (pagination && pagination.hasNextPage) {
                    setTimeout(() => {
                        pagination.nextPage();
                    }, 2000);
                } else {
                    resolve();
                }
            } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                resolve();
            } else {
                console.warn("Places Search Status:", status);
                resolve(); // Continue anyway
            }
        });
    });
}

function addLeadToTable(place, categoryKeyword) {
    // Avoid duplicates
    if (leadsData.some(l => l.google_maps_url === place.url)) return;

    const lead = {
        business_name: place.name || "",
        contact_person: "",
        phone: place.formatted_phone_number || "",
        email: "",
        website: place.website || "",
        category: categoryKeyword,
        address: place.formatted_address || "",
        google_maps_url: place.url || "",
        notes: ""
    };

    leadsData.push(lead);
    
    renderRow(lead);
    createMarker(place); // Add Red Pin to Map
}

// --- UI Rendering ---

function renderRow(lead) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><strong>${lead.business_name}</strong></td>
        <td contenteditable="true" class="editable">${lead.contact_person}</td>
        <td>${lead.phone}</td>
        <td contenteditable="true" class="editable">${lead.email}</td>
        <td>${lead.website ? `<a href="${lead.website}" target="_blank">Link</a>` : ''}</td>
        <td>${lead.category}</td>
        <td>${lead.address}</td>
        <td><a href="${lead.google_maps_url}" target="_blank">Map</a></td>
        <td contenteditable="true" class="editable note-cell">${lead.notes}</td>
    `;
    
    // Listen for manual edits
    tr.querySelectorAll('.editable').forEach((cell, index) => {
        cell.addEventListener('input', (e) => {
            if(index === 0) lead.contact_person = e.target.innerText;
            if(index === 1) lead.email = e.target.innerText;
            if(index === 2) lead.notes = e.target.innerText;
        });
    });

    tableBody.appendChild(tr);
}

function renderTable() {
    tableBody.innerHTML = '';
}

function setLoading(active) {
    isSearching = active;
    btnSearch.disabled = active;
    btnSearch.textContent = active ? "Searching..." : "Search Leads";
}

function updateStatus(msg) {
    statusDiv.textContent = msg;
}

// --- Export Logic ---

function getFormattedDate() {
    const d = new Date();
    return d.toISOString().split('T')[0];
}

function exportToCSV() {
    if (leadsData.length === 0) {
        alert("No data to export.");
        return;
    }

    const headers = ["Business Name", "Contact Person", "Phone", "Email", "Website", "Category", "Address", "Google Maps URL", "Notes"];
    const rows = leadsData.map(l => [
        `"${l.business_name.replace(/"/g, '""')}"`,
        `"${l.contact_person}"`,
        `"${l.phone}"`,
        `"${l.email}"`,
        `"${l.website}"`,
        `"${l.category}"`,
        `"${l.address.replace(/"/g, '""')}"`,
        `"${l.google_maps_url}"`,
        `"${l.notes}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", `otrerastone_leads_${getFormattedDate()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function copyToClipboard() {
    if (leadsData.length === 0) {
        alert("No data to copy.");
        return;
    }

    const rows = leadsData.map(l => 
        `${l.business_name}\t${l.contact_person}\t${l.phone}\t${l.email}\t${l.website}\t${l.category}\t${l.address}\t${l.google_maps_url}\t${l.notes}`
    );
    
    const textData = rows.join('\n');
    
    navigator.clipboard.writeText(textData).then(() => {
        updateStatus("Data copied to clipboard (TSV format).");
        setTimeout(() => updateStatus("Completed"), 3000);
    }).catch(err => {
        alert("Failed to copy: " + err);
    });
}