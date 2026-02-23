Indoor Positioning Pipeline
Applying a 2D Constant-Velocity Kalman Filter on Top of Weighted kNN
Scope: This document describes, step-by-step, how to implement temporal filtering (Kalman filter) after weighted kNN Wi-Fi fingerprinting output, using node-based map model.

1. Definitions and Coordinate System
1.1 Map coordinate unit
The dataset defines nodes with integer coordinates (x, y) (for example x=1..5, y=1..11) and a tileSizeFeet = 3.
Choose one of these two consistent representations and keep it fixed:
Option A (recommended): work in meters
tileMeters = tileSizeFeet * 0.3048
For any node with tile coordinates (x_tile, y_tile):
x_m = x_tile * tileMeters
y_m = y_tile * tileMeters
All Kalman mathematics will operate in meters.
Option B: work in tiles
All Kalman computations operate in tiles. In this case, the measurement noise R must also be expressed in tiles², not meters².
This document assumes Option A (meters).

2. Inputs and Outputs
2.1 Inputs per scan
At runtime, for each Wi-Fi scan at time t_k:
scan_k: set of {bssid, rssi} pairs from the POS device
timestamp_k (milliseconds or seconds)
2.2 Output per scan
For each scan we output a stable filtered position:
p_k = (x_k, y_k) in meters (or convert back to tiles/pixels for rendering)

3. Step 1 (Existing): Weighted kNN Position Measurement
Kalman filtering requires a measurement z_k. The measurement comes from weighted kNN.
3.1 Build a consistent RSSI vector
Let there be M access points in the fingerprint set, in a fixed order:
[
\mathcal{B} = [b_1, b_2, \dots, b_M]
]
Build the scan vector:
[
s_k = [rssi(b_1), rssi(b_2), \dots, rssi(b_M)]
]
If an AP is missing in the scan, assign a floor value (example -100 dBm) so the vector is always length M.
3.2 Node fingerprint vectors
For each node i, build:
[
n_i = [rssi_i(b_1), rssi_i(b_2), \dots, rssi_i(b_M)]
]
3.3 Distance metric in RSSI-space
Use Euclidean distance:
[
d_i = \sqrt{\sum_{j=1}^{M}(s_{k,j} - n_{i,j})^2}
]
3.4 Select K nearest nodes
Let the nearest nodes be indices:
[
{i_1, i_2, \dots, i_K}
]
Usually K=3.
3.5 Compute weights
[
w_{i_m} = \frac{1}{d_{i_m} + \epsilon}
]
where (\epsilon) is small (example 0.01) to avoid division by zero.
3.6 Compute weighted-average position (in tiles)
If node i has tile coordinates (x_i, y_i):
[
x_{wifi,tiles} = \frac{\sum_{m=1}^{K} w_{i_m} x_{i_m}}{\sum_{m=1}^{K} w_{i_m}}
]
[
y_{wifi,tiles} = \frac{\sum_{m=1}^{K} w_{i_m} y_{i_m}}{\sum_{m=1}^{K} w_{i_m}}
]
3.7 Convert to meters (measurement)
[
x_{wifi} = x_{wifi,tiles} \cdot tileMeters
]
[
y_{wifi} = y_{wifi,tiles} \cdot tileMeters
]
Define the measurement vector:
[
z_k =
\begin{bmatrix}
x_{wifi}\
y_{wifi}
\end{bmatrix}
]
This z_k is the input to the Kalman update step.

4. Step 2 (Recommended): Measurement Gating Before Kalman Update
Before updating Kalman with z_k, reject outliers that are physically implausible.
Let the current filtered position be:
[
p_{k-1} = (x_{k-1}, y_{k-1})
]
Compute:
[
\Delta = | z_k - p_{k-1} |
]
If:
Δ > gateDistanceMeters AND we have no indication of movement,
then ignore this measurement and do not call the Kalman update step.
Example:
gateDistanceMeters = 4.0
This prevents a single bad Wi-Fi match from corrupting the filter state.

5. Step 3 (New): 2D Constant-Velocity Kalman Filter
5.1 State vector
The filter state is:
[
X_k =
\begin{bmatrix}
x_k\
y_k\
v_{x,k}\
v_{y,k}
\end{bmatrix}
]
Where:
(x_k, y_k): position (meters)
(v_{x,k}, v_{y,k}): velocity (meters/second), estimated by the filter
5.2 Time step
Compute time delta:
[
dt = t_k - t_{k-1}
]
in seconds. Clamp it to a safe range:
dt = min(max(dt, 0.05), 1.0)
This avoids numerical instability when scans are delayed.

5.3 System model (prediction)
5.3.1 State transition matrix
[
F(dt)=
\begin{bmatrix}
1 & 0 & dt & 0 \
0 & 1 & 0 & dt \
0 & 0 & 1 & 0 \
0 & 0 & 0 & 1
\end{bmatrix}
]
5.3.2 Predicted state
[
\hat{X}k = F X{k-1}
]
5.3.3 Predicted covariance
Let (P_{k-1}) be the previous covariance.
[
\hat{P}k = F P{k-1} F^T + Q
]

5.4 Measurement model (update)
5.4.1 Measurement matrix
Wi-Fi measures only position:
[
H=
\begin{bmatrix}
1 & 0 & 0 & 0 \
0 & 1 & 0 & 0
\end{bmatrix}
]
5.4.2 Innovation
[
y_k = z_k - H\hat{X}_k
]
5.4.3 Innovation covariance
[
S_k = H\hat{P}_kH^T + R
]
5.4.4 Kalman gain
[
K_k = \hat{P}_k H^T S_k^{-1}
]
5.4.5 Updated state
[
X_k = \hat{X}_k + K_k y_k
]
5.4.6 Updated covariance
[
P_k = (I - K_k H)\hat{P}_k
]
Our filtered position output for this scan is:
[
p_k = (X_k[0], X_k[1])
]

6. Tuning Parameters (Q and R)
6.1 Measurement noise R
Wi-Fi is noisy. Use:
[
R =
\begin{bmatrix}
\sigma_x^2 & 0\
0 & \sigma_y^2
\end{bmatrix}
]
A practical starting point in meters:
(\sigma_x \approx \sigma_y \approx 1.6) meters gives variance ≈ 2.5
So:
[
R = diag([2.5, 2.5])
]
6.2 Process noise Q
Q controls how quickly we allow velocity to change (responsiveness vs smoothness). Start with:
[
Q = diag([0.05, 0.05, 0.1, 0.1])
]
This assumes meters and seconds.
Recommended dt-scaled Q (more stable)
A simple scaling that behaves consistently:
[
Q(dt) = diag([q_p \cdot dt^2, q_p \cdot dt^2, q_v \cdot dt, q_v \cdot dt])
]
Example:
q_p = 0.05
q_v = 0.1

7. Initialization Procedure (First Scan)
On the first valid measurement (z_0):
Set:
[
X_0=
\begin{bmatrix}
z_0[0]\
z_0[1]\
0\
0
\end{bmatrix}
]
Initialize covariance (P_0) as:
[
P_0 = diag([5, 5, 10, 10])
]
This encodes:
moderate uncertainty in starting position
higher uncertainty in starting velocity

8. Full Runtime Algorithm (Line-by-Line)
For each scan k:
Read timestamp_k.
Compute dt = (timestamp_k - timestamp_{k-1}) / 1000.0.
Clamp dt into [0.05, 1.0].
Convert scan {bssid,rssi} into vector s_k using the fixed AP order.
For each node i:
build fingerprint vector n_i
compute distance (d_i)
Sort nodes by (d_i).
Select top K=3.
Compute weights (w_i = 1/(d_i + \epsilon)).
Compute weighted position in tiles ((x_{wifi,tiles}, y_{wifi,tiles})).
Convert to meters:
x_wifi = x_wifi_tiles * tileMeters
y_wifi = y_wifi_tiles * tileMeters
Build measurement:
[
z_k=\begin{bmatrix}x_{wifi}\y_{wifi}\end{bmatrix}
]
Kalman Predict:
compute (F(dt))
(\hat{X}k = F X{k-1})
(\hat{P}k = F P{k-1} F^T + Q(dt))
Measurement gating:
(\Delta = |z_k - (\hat{X}_k[0],\hat{X}_k[1])|)
if Δ > gateDistanceMeters and no movement, skip step 14
Kalman Update:
(y_k = z_k - H\hat{X}_k)
(S_k = H\hat{P}_kH^T + R)
(K_k = \hat{P}_k H^T S_k^{-1})
(X_k = \hat{X}_k + K_k y_k)
(P_k = (I - K_kH)\hat{P}_k)
Output:
x_out = X_k[0]
y_out = X_k[1]

9. Implementation (Java, EJML) — Complete Reference
9.1 Dependencies (Gradle)
dependencies {
    implementation "org.ejml:ejml-simple:0.43"
}

9.2 Kalman Filter Class (2D CV Model)
import org.ejml.simple.SimpleMatrix;

public final class Kalman2D {

    // State: [x, y, vx, vy]^T
    private SimpleMatrix x;   // 4x1
    private SimpleMatrix P;   // 4x4

    private final SimpleMatrix H;   // 2x4
    private final SimpleMatrix R;   // 2x2

    private final double qPos;
    private final double qVel;

    private boolean initialized = false;

    public Kalman2D(double rVarX, double rVarY, double qPos, double qVel) {
        // H maps state -> measurement [x,y]
        this.H = new SimpleMatrix(new double[][]{
                {1, 0, 0, 0},
                {0, 1, 0, 0}
        });

        // Measurement noise
        this.R = SimpleMatrix.diag(rVarX, rVarY);

        // Process noise parameters (dt-scaled)
        this.qPos = qPos;
        this.qVel = qVel;
    }

    public boolean isInitialized() { return initialized; }

    public void init(double x0, double y0) {
        this.x = new SimpleMatrix(4, 1);
        this.x.set(0, 0, x0);
        this.x.set(1, 0, y0);
        this.x.set(2, 0, 0.0);
        this.x.set(3, 0, 0.0);

        // Initial covariance: tune if needed
        this.P = SimpleMatrix.diag(5.0, 5.0, 10.0, 10.0);

        this.initialized = true;
    }

    public void predict(double dt) {
        if (!initialized) return;

        SimpleMatrix F = new SimpleMatrix(new double[][]{
                {1, 0, dt, 0},
                {0, 1, 0, dt},
                {0, 0, 1,  0},
                {0, 0, 0,  1}
        });

        // dt-scaled Q
        SimpleMatrix Q = SimpleMatrix.diag(
                qPos * dt * dt,
                qPos * dt * dt,
                qVel * dt,
                qVel * dt
        );

        x = F.mult(x);
        P = F.mult(P).mult(F.transpose()).plus(Q);
    }

    public void update(double measX, double measY) {
        if (!initialized) return;

        SimpleMatrix z = new SimpleMatrix(2, 1);
        z.set(0, 0, measX);
        z.set(1, 0, measY);

        // Innovation y = z - Hx
        SimpleMatrix y = z.minus(H.mult(x));

        // S = HPH^T + R
        SimpleMatrix S = H.mult(P).mult(H.transpose()).plus(R);

        // K = P H^T S^-1
        SimpleMatrix K = P.mult(H.transpose()).mult(S.invert());

        // x = x + K y
        x = x.plus(K.mult(y));

        // P = (I - K H) P
        SimpleMatrix I = SimpleMatrix.identity(4);
        P = (I.minus(K.mult(H))).mult(P);
    }

    public double getX() { return x.get(0,0); }
    public double getY() { return x.get(1,0); }
    public double getVx() { return x.get(2,0); }
    public double getVy() { return x.get(3,0); }
}


10. Integration: Weighted kNN + Kalman (Exact Control Flow)
Create one Kalman2D instance per device/session.
Recommended starting tuning (meters):
R = diag([2.5, 2.5])
qPos = 0.05
qVel = 0.1
Kalman2D kf = new Kalman2D(
        2.5, 2.5,   // R variances in meters^2
        0.05, 0.1   // qPos, qVel
);

Per scan:
// 1) compute dt
double dt = (tsMs - lastTsMs) / 1000.0;
dt = Math.max(0.05, Math.min(dt, 1.0));

// 2) Weighted kNN -> (xWifiTiles, yWifiTiles)
double xWifiTiles = ...; // from our Step 1 implementation
double yWifiTiles = ...;

double tileMeters = 3.0 * 0.3048;
double xWifi = xWifiTiles * tileMeters;
double yWifi = yWifiTiles * tileMeters;

// 3) init if needed
if (!kf.isInitialized()) {
    kf.init(xWifi, yWifi);
    lastTsMs = tsMs;
    return new double[]{kf.getX(), kf.getY()};
}

// 4) predict
kf.predict(dt);

// 5) gating (optional but recommended)
double dx = xWifi - kf.getX();
double dy = yWifi - kf.getY();
double dist = Math.sqrt(dx*dx + dy*dy);

double gateDistanceMeters = 4.0;
boolean accept = dist <= gateDistanceMeters;

// 6) update
if (accept) {
    kf.update(xWifi, yWifi);
}

// 7) output filtered position
lastTsMs = tsMs;
return new double[]{kf.getX(), kf.getY()};


11. What This Produces Operationally
If the POS is stationary: velocity converges toward zero, and the output dot remains stable instead of chasing RSSI noise.
If the POS moves: the filter learns a velocity vector and produces smooth movement rather than scan-by-scan jitter.
If a scan is wrong: gating prevents a single outlier from pulling the dot across the map.


1) Implementation contract
1.1 Fixed assumptions
Node (x, y) are tile coordinates (as in our dataset).
tileSizeFeet is used to convert tiles to meters:
tileMeters = tileSizeFeet * 0.3048.
We have a live scan from the device: {bssid -> rssi}.
1.2 What we will store in memory
We will build an IndoorMap object once per floor:
bssidOrder[]: fixed BSSID list (from accessPoints)
nodes[]: each node has:
tile position (xTile, yTile)
fingerprint vector rssiVec[] in the same order as bssidOrder
This makes runtime fast and deterministic.

2) Data model (Java)
Use these small classes.
import java.util.*;

public final class IndoorMap {
    public final int floor;
    public final double tileSizeFeet;
    public final double tileMeters;
    public final List<String> bssidOrder;
    public final List<NodeFingerprint> nodes;

    public IndoorMap(int floor,
                     double tileSizeFeet,
                     List<String> bssidOrder,
                     List<NodeFingerprint> nodes) {
        this.floor = floor;
        this.tileSizeFeet = tileSizeFeet;
        this.tileMeters = tileSizeFeet * 0.3048;
        this.bssidOrder = Collections.unmodifiableList(new ArrayList<>(bssidOrder));
        this.nodes = Collections.unmodifiableList(new ArrayList<>(nodes));
    }
}

public final class NodeFingerprint {
    public final int id;
    public final double xTile;
    public final double yTile;
    public final double[] rssiVec; // length = M, aligned with map.bssidOrder

    public NodeFingerprint(int id, double xTile, double yTile, double[] rssiVec) {
        this.id = id;
        this.xTile = xTile;
        this.yTile = yTile;
        this.rssiVec = rssiVec;
    }
}


3) Parse exact JSON into IndoorMap
This parser uses org.json (available on Android). If we prefer Gson/Jackson, the logic stays identical.
3.1 Add import
import org.json.*;

3.2 Parser implementation
public final class IndoorMapParser {

    // If a BSSID is missing in scan or node fingerprint, fill with this value.
    // Typical fingerprinting default is around -95 to -110 dBm.
    private static final double MISSING_RSSI = -100.0;

    public static IndoorMap parseFromJson(String json) throws JSONException {
        JSONObject root = new JSONObject(json);

        int floor = root.getInt("floor");
        double tileSizeFeet = root.getDouble("tileSizeFeet");

        // 1) Fixed BSSID order from "accessPoints"
        JSONArray aps = root.getJSONArray("accessPoints");
        List<String> bssidOrder = new ArrayList<>();
        for (int i = 0; i < aps.length(); i++) {
            JSONObject ap = aps.getJSONObject(i);
            String bssid = ap.getString("bssid").toLowerCase(Locale.ROOT);
            bssidOrder.add(bssid);
        }

        // 2) Build BSSID -> index lookup
        Map<String, Integer> bssidToIndex = new HashMap<>();
        for (int i = 0; i < bssidOrder.size(); i++) {
            bssidToIndex.put(bssidOrder.get(i), i);
        }

        // 3) Parse nodes and convert each node's "rssis" list to a fixed rssiVec[]
        JSONArray nodesJson = root.getJSONArray("nodes");
        List<NodeFingerprint> nodes = new ArrayList<>();

        for (int i = 0; i < nodesJson.length(); i++) {
            JSONObject n = nodesJson.getJSONObject(i);

            int id = n.getInt("id");
            double xTile = n.getDouble("x");
            double yTile = n.getDouble("y");

            double[] rssiVec = new double[bssidOrder.size()];
            Arrays.fill(rssiVec, MISSING_RSSI);

            JSONArray rssis = n.getJSONArray("rssis");
            for (int r = 0; r < rssis.length(); r++) {
                JSONObject rr = rssis.getJSONObject(r);
                String bssid = rr.getString("bssid").toLowerCase(Locale.ROOT);
                double rssi = rr.getDouble("rssi");

                Integer idx = bssidToIndex.get(bssid);
                if (idx != null) {
                    rssiVec[idx] = rssi;
                }
            }

            nodes.add(new NodeFingerprint(id, xTile, yTile, rssiVec));
        }

        return new IndoorMap(floor, tileSizeFeet, bssidOrder, nodes);
    }
}


4) Weighted kNN estimator (exact)
4.1 Mathematical definition
Let:
Scan RSSI vector ( s \in \mathbb{R}^M )
Node fingerprint vector ( n_i \in \mathbb{R}^M )
Distance:
[
d_i = \sqrt{\sum_{j=1}^M (s_j - n_{i,j})^2}
]
Pick K nearest nodes.
Weights:
[
w_i = \frac{1}{d_i + \epsilon}
]
Weighted average (tiles):
[
x_{wifi} = \frac{\sum w_i x_i}{\sum w_i}, \quad
y_{wifi} = \frac{\sum w_i y_i}{\sum w_i}
]
4.2 Implementation
public final class WeightedKnnPositioner {

    private static final double EPS = 0.01;
    private static final double MISSING_RSSI = -100.0;

    public static final class Result {
        public final double xWifiTiles;
        public final double yWifiTiles;
        public final int[] topNodeIds;        // debugging
        public final double[] topDistances;   // debugging
        public Result(double xWifiTiles, double yWifiTiles, int[] topNodeIds, double[] topDistances) {
            this.xWifiTiles = xWifiTiles;
            this.yWifiTiles = yWifiTiles;
            this.topNodeIds = topNodeIds;
            this.topDistances = topDistances;
        }
    }

    private static final class Candidate {
        final NodeFingerprint node;
        final double dist;
        Candidate(NodeFingerprint node, double dist) {
            this.node = node;
            this.dist = dist;
        }
    }

    /**
     * @param map IndoorMap with fixed bssidOrder and precomputed node rssiVec[]
     * @param scanRssiByBssid live scan, keys are bssid strings
     * @param K number of nearest nodes (recommend 3)
     */
    public static Result estimateWifiPositionTiles(IndoorMap map,
                                                   Map<String, Integer> scanRssiByBssid,
                                                   int K) {

        // 1) Build scan vector s aligned to map.bssidOrder
        int M = map.bssidOrder.size();
        double[] s = new double[M];
        Arrays.fill(s, MISSING_RSSI);

        for (int j = 0; j < M; j++) {
            String bssid = map.bssidOrder.get(j);
            Integer rssi = scanRssiByBssid.get(bssid);
            if (rssi != null) s[j] = rssi;
        }

        // 2) Compute distance to every node
        List<Candidate> candidates = new ArrayList<>(map.nodes.size());
        for (NodeFingerprint nf : map.nodes) {
            double dist = euclidean(s, nf.rssiVec);
            candidates.add(new Candidate(nf, dist));
        }

        // 3) Sort ascending by distance
        candidates.sort(Comparator.comparingDouble(c -> c.dist));

        int useK = Math.min(K, candidates.size());

        // 4) Weighted average over top K
        double sumW = 0.0;
        double sumX = 0.0;
        double sumY = 0.0;

        int[] topIds = new int[useK];
        double[] topD = new double[useK];

        for (int i = 0; i < useK; i++) {
            Candidate c = candidates.get(i);
            topIds[i] = c.node.id;
            topD[i] = c.dist;

            double w = 1.0 / (c.dist + EPS);
            sumW += w;
            sumX += w * c.node.xTile;
            sumY += w * c.node.yTile;
        }

        // 5) If sumW is zero (pathological), fallback to best node
        if (sumW <= 1e-9) {
            Candidate best = candidates.get(0);
            return new Result(best.node.xTile, best.node.yTile, topIds, topD);
        }

        double xWifiTiles = sumX / sumW;
        double yWifiTiles = sumY / sumW;

        return new Result(xWifiTiles, yWifiTiles, topIds, topD);
    }

    private static double euclidean(double[] a, double[] b) {
        double s = 0.0;
        for (int i = 0; i < a.length; i++) {
            double d = a[i] - b[i];
            s += d * d;
        }
        return Math.sqrt(s);
    }
}


5) Kalman filter implementation (EJML) — already complete
Reuse the Kalman2D class previously provided. For completeness, here it is again, unchanged:
import org.ejml.simple.SimpleMatrix;

public final class Kalman2D {

    // State: [x, y, vx, vy]^T
    private SimpleMatrix x;   // 4x1
    private SimpleMatrix P;   // 4x4

    private final SimpleMatrix H;   // 2x4
    private final SimpleMatrix R;   // 2x2

    private final double qPos;
    private final double qVel;

    private boolean initialized = false;

    public Kalman2D(double rVarX, double rVarY, double qPos, double qVel) {
        this.H = new SimpleMatrix(new double[][]{
                {1, 0, 0, 0},
                {0, 1, 0, 0}
        });
        this.R = SimpleMatrix.diag(rVarX, rVarY);
        this.qPos = qPos;
        this.qVel = qVel;
    }

    public boolean isInitialized() { return initialized; }

    public void init(double x0, double y0) {
        this.x = new SimpleMatrix(4, 1);
        this.x.set(0, 0, x0);
        this.x.set(1, 0, y0);
        this.x.set(2, 0, 0.0);
        this.x.set(3, 0, 0.0);

        this.P = SimpleMatrix.diag(5.0, 5.0, 10.0, 10.0);
        this.initialized = true;
    }

    public void predict(double dt) {
        if (!initialized) return;

        SimpleMatrix F = new SimpleMatrix(new double[][]{
                {1, 0, dt, 0},
                {0, 1, 0, dt},
                {0, 0, 1,  0},
                {0, 0, 0,  1}
        });

        SimpleMatrix Q = SimpleMatrix.diag(
                qPos * dt * dt,
                qPos * dt * dt,
                qVel * dt,
                qVel * dt
        );

        x = F.mult(x);
        P = F.mult(P).mult(F.transpose()).plus(Q);
    }

    public void update(double measX, double measY) {
        if (!initialized) return;

        SimpleMatrix z = new SimpleMatrix(2, 1);
        z.set(0, 0, measX);
        z.set(1, 0, measY);

        SimpleMatrix y = z.minus(H.mult(x));
        SimpleMatrix S = H.mult(P).mult(H.transpose()).plus(R);
        SimpleMatrix K = P.mult(H.transpose()).mult(S.invert());

        SimpleMatrix I = SimpleMatrix.identity(4);
        x = x.plus(K.mult(y));
        P = (I.minus(K.mult(H))).mult(P);
    }

    public double getX() { return x.get(0,0); }
    public double getY() { return x.get(1,0); }
    public double getVx() { return x.get(2,0); }
    public double getVy() { return x.get(3,0); }
}


6) Full integration class: “Weighted kNN + Kalman” in one service
This is the piece to call from the scan loop.
6.1 What it does per scan (line-by-line)
Convert scan list → Map<bssid, rssi>.
Weighted kNN → (xWifiTiles, yWifiTiles).
Convert to meters using tileMeters.
Compute dt.
predict(dt).
Gate the measurement (reject large teleports).
update(xWifiMeters, yWifiMeters) if accepted.
Output filtered (xMeters, yMeters).
6.2 Implementation
import java.util.*;

public final class IndoorPositioningEngine {

    private final IndoorMap map;
    private final Kalman2D kf;

    private long lastTsMs = -1;

    // Gating distance: reject measurements that jump too far
    private final double gateDistanceMeters;

    // Weighted kNN K
    private final int K;

    public IndoorPositioningEngine(IndoorMap map) {
        this.map = map;

        // Tuning (starting point)
        double rVarX = 2.5; // meters^2
        double rVarY = 2.5; // meters^2
        double qPos = 0.05;
        double qVel = 0.1;

        this.kf = new Kalman2D(rVarX, rVarY, qPos, qVel);

        this.gateDistanceMeters = 4.0;
        this.K = 3;
    }

    public static final class Output {
        public final double xMeters;
        public final double yMeters;

        // Optional debug fields
        public final double xWifiMeters;
        public final double yWifiMeters;
        public final int[] topNodeIds;
        public final double[] topDistances;

        public Output(double xMeters, double yMeters,
                      double xWifiMeters, double yWifiMeters,
                      int[] topNodeIds, double[] topDistances) {
            this.xMeters = xMeters;
            this.yMeters = yMeters;
            this.xWifiMeters = xWifiMeters;
            this.yWifiMeters = yWifiMeters;
            this.topNodeIds = topNodeIds;
            this.topDistances = topDistances;
        }
    }

    /**
     * @param timestampMs scan time
     * @param scanRssiByBssid live scan map (lowercase bssid -> rssi int)
     */
    public Output processScan(long timestampMs, Map<String, Integer> scanRssiByBssid) {

        // 1) Weighted kNN -> wifi position in tiles
        WeightedKnnPositioner.Result wifiTiles =
                WeightedKnnPositioner.estimateWifiPositionTiles(map, scanRssiByBssid, K);

        // 2) Convert to meters
        double xWifiMeters = wifiTiles.xWifiTiles * map.tileMeters;
        double yWifiMeters = wifiTiles.yWifiTiles * map.tileMeters;

        // 3) Initialize KF on first scan
        if (!kf.isInitialized()) {
            kf.init(xWifiMeters, yWifiMeters);
            lastTsMs = timestampMs;
            return new Output(
                    kf.getX(), kf.getY(),
                    xWifiMeters, yWifiMeters,
                    wifiTiles.topNodeIds, wifiTiles.topDistances
            );
        }

        // 4) Compute dt (seconds) and clamp
        double dt = (timestampMs - lastTsMs) / 1000.0;
        dt = Math.max(0.05, Math.min(dt, 1.0));

        // 5) Predict
        kf.predict(dt);

        // 6) Gating based on distance from predicted/filtered position
        double dx = xWifiMeters - kf.getX();
        double dy = yWifiMeters - kf.getY();
        double dist = Math.sqrt(dx*dx + dy*dy);

        boolean accept = dist <= gateDistanceMeters;

        // 7) Update if accepted
        if (accept) {
            kf.update(xWifiMeters, yWifiMeters);
        }

        // 8) Save timestamp and output filtered position
        lastTsMs = timestampMs;

        return new Output(
                kf.getX(), kf.getY(),
                xWifiMeters, yWifiMeters,
                wifiTiles.topNodeIds, wifiTiles.topDistances
        );
    }
}


7) How to call it from scan loop
7.1 One-time setup
Parse the map JSON ( provided structure).
Create the engine.
IndoorMap map = IndoorMapParser.parseFromJson(MAP_JSON_STRING);
IndoorPositioningEngine engine = new IndoorPositioningEngine(map);

7.2 Each time we receive a Wi-Fi scan
Convert scan list → map, then call processScan.
Map<String, Integer> scanMap = new HashMap<>();
scanMap.put("7c:f1:7e:52:11:bf", -43);
scanMap.put("7c:f1:7e:52:11:c0", -50);
scanMap.put("3a:22:e2:92:3e:2c", -59);
scanMap.put("be:31:ef:aa:45:b8", -52);

long ts = System.currentTimeMillis();

IndoorPositioningEngine.Output out = engine.processScan(ts, toLowercaseKeys(scanMap));

double xMeters = out.xMeters;
double yMeters = out.yMeters;

// Render: convert meters -> pixels if we have a scale,
// or meters -> tiles by dividing by map.tileMeters.

Helper:
private static Map<String, Integer> toLowercaseKeys(Map<String, Integer> in) {
    Map<String, Integer> out = new HashMap<>();
    for (Map.Entry<String, Integer> e : in.entrySet()) {
        out.put(e.getKey().toLowerCase(Locale.ROOT), e.getValue());
    }
    return out;
}


8) Notes that matter in real deployments
8.1 Why velocity works without accelerometer
We are not “measuring velocity.” The Kalman filter estimates vx, vy from consistent changes in filtered position across time. When the device is stable, the estimate naturally converges toward zero.
8.2 Missing BSSIDs
The implementation uses -100 dBm for missing APs. This must be consistent for both:
scans that do not see an AP
nodes that do not list an AP
8.3 Performance
For the current dataset (~16 nodes), brute force distance to all nodes is trivial. If we later have thousands of nodes, we can pre-index, but do not optimize early.



